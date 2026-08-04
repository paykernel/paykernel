// file: packages/core/src/runtime/payment-runtime.ts

import type { Clock } from "./clock";
import { systemClock } from "./clock";
import type { CryptoProvider } from "./crypto-provider";
import { resolveDefaultCrypto } from "./crypto-provider";

/**
 * Portable dependency bag for HTTP, crypto, clock, and UUIDs.
 *
 * Matches roadmap Phase 8.1. Gateways should prefer values from
 * {@link GatewayContext} (which includes these fields) over bare globals.
 *
 * **Never** put API keys, webhook secrets, DB handles, or request objects here.
 *
 * @see createPaymentRuntime
 * @see docs/runtime.md
 */
export interface PaymentRuntime {
  fetch: typeof globalThis.fetch;
  crypto: CryptoProvider;
  clock: Clock;
  randomUUID(): string;
}

/**
 * Partial runtime bag accepted by gateway constructors (4th arg after logger).
 * When omitted, gateways call {@link createPaymentRuntime} with portable defaults.
 */
export type GatewayRuntimeDeps = Partial<PaymentRuntime>;

/**
 * Always-delegate default fetch so tests that patch `globalThis.fetch` after
 * construction still hit the mock (binding a snapshot would freeze the original).
 *
 * Typed as `typeof globalThis.fetch` so hosts that attach `preconnect` (Bun /
 * modern lib.dom) accept the value under `exactOptionalPropertyTypes`-style
 * structural checks without requiring every mock to implement `preconnect`.
 */
function createDefaultFetch(): typeof globalThis.fetch {
  const invoke = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => globalThis.fetch(input, init);
  // Copy static members (e.g. preconnect) when present on host fetch.
  return Object.assign(invoke, {
    preconnect:
      typeof globalThis.fetch.preconnect === "function"
        ? globalThis.fetch.preconnect.bind(globalThis.fetch)
        : undefined,
  }) as typeof globalThis.fetch;
}

/**
 * Build a {@link PaymentRuntime} with portable defaults from `globalThis`.
 *
 * Defaults:
 * - `fetch`: delegates to live `globalThis.fetch` (not a frozen snapshot)
 * - `crypto`: Web Crypto when available ({@link resolveDefaultCrypto})
 * - `clock`: system `Date` / `Date.now`
 * - `randomUUID`: `crypto.randomUUID`
 *
 * Partial overrides replace individual fields. Does not accept secrets.
 */
export function createPaymentRuntime(
  partial: Partial<PaymentRuntime> = {},
): PaymentRuntime {
  const crypto = partial.crypto ?? resolveDefaultCrypto();
  return {
    fetch: partial.fetch ?? createDefaultFetch(),
    crypto,
    clock: partial.clock ?? systemClock,
    randomUUID: partial.randomUUID ?? (() => crypto.randomUUID()),
  };
}

/**
 * Merge a partial runtime over a base. Unspecified keys keep the base value.
 */
export function mergePaymentRuntime(
  base: PaymentRuntime,
  partial?: Partial<PaymentRuntime>,
): PaymentRuntime {
  if (partial === undefined) {
    return base;
  }
  return {
    fetch: partial.fetch ?? base.fetch,
    crypto: partial.crypto ?? base.crypto,
    clock: partial.clock ?? base.clock,
    randomUUID: partial.randomUUID ?? base.randomUUID,
  };
}

/**
 * Project PaymentRuntime fields from any object that carries them
 * (e.g. {@link GatewayContext}).
 */
export function paymentRuntimeFromContext(
  ctx: PaymentRuntime,
): PaymentRuntime {
  return {
    fetch: ctx.fetch,
    crypto: ctx.crypto,
    clock: ctx.clock,
    randomUUID: ctx.randomUUID,
  };
}
