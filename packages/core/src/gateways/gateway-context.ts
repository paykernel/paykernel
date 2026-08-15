// file: packages/core/src/gateways/gateway-context.ts

import { HooksManager } from "../hooks/hooks.manager";
import { noopLogger, redact, type Logger } from "../utils/logger";
import type { PaymentRuntime } from "../runtime/payment-runtime";
import { createPaymentRuntime } from "../runtime/payment-runtime";

// Re-export CryptoProvider for the gateways barrel / public API surface.
export type { CryptoProvider } from "../runtime/crypto-provider";

/**
 * Optional telemetry sink. Keep payloads free of secrets/PII.
 * Prefer {@link createRedactingTelemetrySink} when attaching application sinks.
 */
export interface TelemetrySink {
  emit?(event: string, data?: Record<string, unknown>): void;
}

/**
 * Wrap a {@link TelemetrySink} so every structured `data` bag is scrubbed via
 * the same {@link redact} model as logs before it reaches the sink.
 *
 * Call when injecting application telemetry into {@link GatewayContext} so
 * secrets/PII never leave the SDK path by default.
 */
export function createRedactingTelemetrySink(sink: TelemetrySink): TelemetrySink {
  return {
    emit(event, data?) {
      if (data === undefined) {
        sink.emit?.(event);
      } else {
        sink.emit?.(event, redact(data) as Record<string, unknown>);
      }
    },
  };
}

/**
 * Shared, secret-free dependencies injected into gateway adapters at create time.
 *
 * Composes {@link PaymentRuntime} (fetch / crypto / clock / randomUUID) plus
 * client-owned hooks, logger, uuid alias, and optional telemetry.
 *
 * **Never** put API keys, webhook secrets, DB handles, or request objects here.
 * Credential closure belongs on the adapter factory that calls `create`.
 */
export interface GatewayContext extends PaymentRuntime {
  hooks: HooksManager;
  /** Prefer a redacting logger when constructing from PaymentClient */
  logger: Logger;
  /**
   * Convenience UUID generator (defaults to `randomUUID` from the runtime).
   * Prefer `randomUUID` for new code; `uuid` remains for 0.x call sites.
   */
  uuid: () => string;
  telemetry?: TelemetrySink;
}

/**
 * Options for {@link createDefaultGatewayContext}.
 *
 * Accepts PaymentRuntime fields (individually or via nested `runtime`) plus
 * hooks / logger / uuid / telemetry. Nested `runtime` is merged first; top-level
 * runtime fields override it (exactOptionalPropertyTypes-safe: omit keys).
 */
export type CreateDefaultGatewayContextOptions = Partial<
  Pick<
    GatewayContext,
    "hooks" | "logger" | "fetch" | "clock" | "crypto" | "uuid" | "telemetry"
  >
> & {
  /** Optional partial {@link PaymentRuntime} bag (merged under top-level fields). */
  runtime?: Partial<PaymentRuntime>;
  /** Override `randomUUID` on the composed runtime (also used as default `uuid`). */
  randomUUID?: () => string;
};

/**
 * Create a {@link GatewayContext} with portable defaults for tests and adapters.
 *
 * Defaults come from {@link createPaymentRuntime} (globalThis fetch / Web Crypto /
 * system clock). Partial overrides replace individual fields. Does not accept secrets.
 * Provided {@link TelemetrySink} instances are wrapped with
 * {@link createRedactingTelemetrySink} (double-wrap is safe).
 */
export function createDefaultGatewayContext(
  partial: CreateDefaultGatewayContextOptions = {},
): GatewayContext {
  // Nested runtime first, then top-level PaymentRuntime fields.
  let runtimePartial: Partial<PaymentRuntime> | undefined;
  if (partial.runtime !== undefined) {
    runtimePartial = { ...partial.runtime };
  }
  if (partial.fetch !== undefined) {
    runtimePartial = { ...runtimePartial, fetch: partial.fetch };
  }
  if (partial.crypto !== undefined) {
    runtimePartial = { ...runtimePartial, crypto: partial.crypto };
  }
  if (partial.clock !== undefined) {
    runtimePartial = { ...runtimePartial, clock: partial.clock };
  }
  if (partial.randomUUID !== undefined) {
    runtimePartial = { ...runtimePartial, randomUUID: partial.randomUUID };
  }

  const runtime =
    runtimePartial !== undefined
      ? createPaymentRuntime(runtimePartial)
      : createPaymentRuntime();

  const uuid = partial.uuid ?? (() => runtime.randomUUID());

  const ctx: GatewayContext = {
    hooks: partial.hooks ?? new HooksManager(),
    logger: partial.logger ?? noopLogger,
    fetch: runtime.fetch,
    clock: runtime.clock,
    crypto: runtime.crypto,
    randomUUID: runtime.randomUUID,
    uuid,
  };

  if (partial.telemetry !== undefined) {
    // Same default-safe path as createRedactingLogger on gateway log sinks:
    // wrap so card/secret bags never leave ctx.telemetry unredacted.
    // Double-wrap is idempotent for already-redacted secrets.
    ctx.telemetry = createRedactingTelemetrySink(partial.telemetry);
  }

  return ctx;
}
