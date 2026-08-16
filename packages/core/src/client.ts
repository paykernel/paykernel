// file: packages/payments/src/client.ts

import type { PaymentGateway } from "./gateways/gateway.interface";
import {
  requiredCapabilitiesForOperation,
  type GatewayCapabilityKey,
} from "./gateways/gateway-capabilities";
import type {
  CreatePaymentParams,
  CaptureParams,
  RefundParams,
  VoidParams,
  GetPaymentParams,
  GatewayPaymentResult,
  GatewayRefundResult,
  MoyasarCreatePaymentParams,
  PaymobCreatePaymentParams,
  PayPalCreatePaymentParams,
  PaymentStatus,
} from "./types/payment.types";
import type { WebhookEvent } from "./types/webhook.types";
import {
  attachPaymentEvent,
  isPaymentEvent,
  PAYMENT_EVENT_SCHEMA_VERSION,
} from "./types/payment-event";
import type {
  CreatePaymentClientOptions,
  PaymentClientConfig,
} from "./types/config.types";
import type { StripeCreatePaymentParams } from "./types/validation";
import type { PaymentHooks } from "./hooks/hooks.types";
import { HooksManager } from "./hooks/hooks.manager";
import { MoyasarGateway } from "./gateways/moyasar/moyasar.gateway";
import { PayPalGateway } from "./gateways/paypal/paypal.gateway";
import { PaymobGateway } from "./gateways/paymob/paymob.gateway";
import {
  StripeGateway,
  demoteIncompleteRefundWebhookDualWrite,
  demoteIncompleteSettledWebhookDualWrite,
} from "./gateways/stripe/stripe.gateway";
import {
  createGatewayRegistry,
  type GatewayMap,
  type ImmutableGatewayRegistry,
} from "./gateways/gateway-registry";
import type { GatewayAdapter } from "./gateways/gateway-adapter";
import { createDefaultGatewayContext } from "./gateways/gateway-context";
import {
  GatewayNotConfiguredError,
  InvalidRequestError,
  InvalidWebhookError,
  OperationNotSupportedError,
} from "./errors";
import { createRedactingLogger, noopLogger, type Logger } from "./utils/logger";

/** True when `value` looks like a thenable (Promise). A Promise is truthy — never treat it as verified. */
function isThenable(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Deep-clone a verified {@link WebhookEvent} for `onWebhookVerified` hooks.
 *
 * CORE-2: hooks must not rewrite money/status identity (status, amount, ids,
 * stableType, dual-write event) on the object returned to callers. `Date`
 * timestamps are re-instantiated; `rawPayload` is shallow-copied when it is a
 * plain object so hook annotation of raw is isolated from the returned event.
 */
function cloneWebhookEventForHooks(event: WebhookEvent): WebhookEvent {
  const clone: WebhookEvent = {
    id: event.id,
    type: event.type,
    gateway: event.gateway,
    paymentId: event.paymentId,
    gatewayPaymentId: event.gatewayPaymentId,
    status: event.status,
    timestamp: new Date(event.timestamp.getTime()),
    rawPayload: clonePlainJson(event.rawPayload),
  };
  if (event.gatewayObjectId !== undefined) {
    clone.gatewayObjectId = event.gatewayObjectId;
  }
  if (event.gatewaySubscriptionId !== undefined) {
    clone.gatewaySubscriptionId = event.gatewaySubscriptionId;
  }
  if (event.gatewayToken !== undefined) {
    clone.gatewayToken = event.gatewayToken;
  }
  if (event.livemode !== undefined) {
    clone.livemode = event.livemode;
  }
  if (event.apiVersion !== undefined) {
    clone.apiVersion = event.apiVersion;
  }
  if (event.amount !== undefined) {
    clone.amount = event.amount;
  }
  if (event.currency !== undefined) {
    clone.currency = event.currency;
  }
  if (event.schemaVersion !== undefined) {
    clone.schemaVersion = event.schemaVersion;
  }
  if (event.event !== undefined) {
    clone.event = clonePlainJson(event.event) as typeof event.event;
  }
  if (event.provider !== undefined) {
    clone.provider = clonePlainJson(event.provider) as typeof event.provider;
  }
  if (event.stableType !== undefined) {
    clone.stableType = event.stableType;
  }
  if (event.payloadHash !== undefined) {
    clone.payloadHash = event.payloadHash;
  }
  return clone;
}

function clonePlainJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map((item) => clonePlainJson(item));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = clonePlainJson(v);
  }
  return out;
}

/**
 * Whether a gateway exposes a Phase 3 capability surface
 * (`capabilities` + `supports`). Pre-Phase-3 plain objects omit these and
 * fall back to optional-method presence checks only.
 */
function hasCapabilitySurface(gw: PaymentGateway): boolean {
  return (
    typeof gw.supports === "function" &&
    gw.capabilities != null &&
    typeof gw.capabilities === "object"
  );
}

/**
 * Default map for legacy `new PaymentClient(...)` typing: all four first-party
 * gateway classes. Runtime only holds gateways that were configured.
 */
export type BuiltInGatewayMap = {
  moyasar: MoyasarGateway;
  paypal: PayPalGateway;
  paymob: PaymobGateway;
  stripe: StripeGateway;
};

/** Brand for {@link PaymentClient.createFromPlugin} internal construction */
const PLUGIN_INIT = Symbol.for("@paykernel/core/PaymentClient.pluginInit");

type PluginInitBag = {
  readonly [PLUGIN_INIT]: true;
  readonly options: CreatePaymentClientOptions;
};

function isPluginInitBag(config: unknown): config is PluginInitBag {
  return (
    typeof config === "object" &&
    config !== null &&
    PLUGIN_INIT in config &&
    (config as PluginInitBag)[PLUGIN_INIT] === true
  );
}

/**
 * Main payment client that orchestrates gateway operations with lifecycle hooks.
 *
 * Prefer {@link createPaymentClient} with a registry or adapters map for new
 * code (typed custom gateways). The constructor accepts the legacy
 * provider-key config and remains supported through 0.x.
 *
 * @typeParam TGateways - Map of registered gateway name → instance type
 *
 * @example Preferred (plugin / registry)
 * ```typescript
 * const client = createPaymentClient({
 *   gateways: {
 *     moyasar: moyasarGateway({ secretKey: 'sk_...' }),
 *   },
 *   defaultGateway: 'moyasar',
 * });
 * ```
 *
 * @example Legacy (deprecated)
 * ```typescript
 * const client = new PaymentClient({
 *   moyasar: { secretKey: 'sk_...' },
 *   defaultGateway: 'moyasar',
 * });
 * ```
 */
export class PaymentClient<TGateways extends GatewayMap = BuiltInGatewayMap> {
  private readonly gateways = new Map<string, PaymentGateway>();
  private readonly hooksManager: HooksManager;
  private readonly defaultGateway: (keyof TGateways & string) | undefined;
  private readonly logger: Logger;

  /**
   * Legacy constructor: configure built-in gateways via provider config keys.
   *
   * @deprecated Prefer {@link createPaymentClient} with
   * `gateways: { stripe: stripeGateway(...), ... }` or a built
   * `createGatewayRegistry()` registry. This constructor remains supported
   * through 0.x for migration.
   *
   * @example
   * ```typescript
   * const client = new PaymentClient({
   *   moyasar: { secretKey: 'sk_...' },
   *   defaultGateway: 'moyasar',
   *   hooks: {
   *     beforeCreatePayment: async (ctx) => {
   *       return { proceed: true };
   *     },
   *   },
   * });
   * ```
   */
  constructor(config: PaymentClientConfig) {
    // Internal plugin path (createPaymentClient) — brand-tagged bag
    if (isPluginInitBag(config)) {
      const options = config.options as CreatePaymentClientOptions<TGateways>;
      this.defaultGateway = options.defaultGateway as
        | (keyof TGateways & string)
        | undefined;
      this.logger = options.logger
        ? createRedactingLogger(options.logger)
        : noopLogger;
      this.hooksManager = new HooksManager(options.hooks, this.logger);
      this.installPartialMoneyCapabilityGuards();
      this.initFromPlugin(options);
      return;
    }

    this.defaultGateway = config.defaultGateway as
      | (keyof TGateways & string)
      | undefined;
    this.logger = config.logger
      ? createRedactingLogger(config.logger)
      : noopLogger;
    // Pass redacting logger so after-hook isolation (proceed:false / throws) is observable
    this.hooksManager = new HooksManager(config.hooks, this.logger);
    this.installPartialMoneyCapabilityGuards();

    PaymentClient.assertGatewayCredentials(config);

    const logger = config.logger;
    // Phase 8: optional runtime bag for legacy constructor (exactOptionalPropertyTypes-safe).
    const runtime = config.runtime;

    if (config.moyasar) {
      this.gateways.set(
        "moyasar",
        new MoyasarGateway(
          config.moyasar,
          this.hooksManager,
          logger,
          runtime,
        ),
      );
    }

    if (config.paypal) {
      this.gateways.set(
        "paypal",
        new PayPalGateway(
          config.paypal,
          this.hooksManager,
          logger,
          runtime,
        ),
      );
    }

    if (config.paymob) {
      this.gateways.set(
        "paymob",
        new PaymobGateway(
          config.paymob,
          this.hooksManager,
          logger,
          runtime,
        ),
      );
    }

    if (config.stripe) {
      this.gateways.set(
        "stripe",
        new StripeGateway(
          config.stripe,
          this.hooksManager,
          logger,
          runtime,
        ),
      );
    }

    if (
      this.defaultGateway !== undefined &&
      !this.gateways.has(this.defaultGateway)
    ) {
      throw new InvalidRequestError(
        `defaultGateway '${this.defaultGateway}' is not configured`,
      );
    }
  }

  /**
   * Internal factory used by {@link createPaymentClient}. Not for direct
   * public use — call `createPaymentClient` instead.
   *
   * Uses a brand-tagged config so the real constructor runs (class fields /
   * `new.target` behave correctly) without exposing a second public ctor shape.
   *
   * @internal
   */
  static createFromPlugin<TMap extends GatewayMap>(
    options: CreatePaymentClientOptions<TMap>,
  ): PaymentClient<TMap> {
    const bag: PluginInitBag = {
      [PLUGIN_INIT]: true,
      options: options as CreatePaymentClientOptions,
    };
    return new PaymentClient(bag as unknown as PaymentClientConfig) as unknown as PaymentClient<TMap>;
  }

  /**
   * Shared plugin initialization (registry or adapters map).
   */
  private initFromPlugin(options: CreatePaymentClientOptions<TGateways>): void {
    const hasRegistry = options.registry !== undefined;
    const hasGatewaysMap = options.gateways !== undefined;

    if (hasRegistry && hasGatewaysMap) {
      throw new InvalidRequestError(
        "createPaymentClient: provide either 'registry' or 'gateways', not both",
      );
    }
    if (!hasRegistry && !hasGatewaysMap) {
      throw new InvalidRequestError(
        "createPaymentClient: provide either 'registry' or 'gateways'",
      );
    }

    // Single GatewayContext for all adapters at construction time.
    // Pass the raw sink (not this.logger): BaseGateway wraps once with
    // createRedactingLogger — same as the legacy constructor path. Feeding the
    // already-redacting client logger would double-wrap every gateway log.
    // Runtime (fetch/crypto/clock/uuid) flows from options.runtime so adapters
    // receive injectable portable deps (Phase 8).
    const context = createDefaultGatewayContext({
      hooks: this.hooksManager,
      ...(options.logger !== undefined ? { logger: options.logger } : {}),
      ...(options.runtime !== undefined ? { runtime: options.runtime } : {}),
    });

    // buildRegistryFromMap erases TGateways at the type level; cast is safe
    // because adapters were validated by name key and create() produces
    // instances matching the registered map keys.
    const registry = (
      hasRegistry
        ? options.registry!
        : PaymentClient.buildRegistryFromMap(
            options.gateways as Record<string, GatewayAdapter>,
          )
    ) as ImmutableGatewayRegistry<TGateways>;

    const instances = registry.createAll(context);
    for (const name of Object.keys(instances)) {
      this.gateways.set(name, instances[name as keyof typeof instances]!);
    }

    if (
      this.defaultGateway !== undefined &&
      !this.gateways.has(this.defaultGateway)
    ) {
      throw new InvalidRequestError(
        `defaultGateway '${String(this.defaultGateway)}' is not configured`,
      );
    }
  }

  /**
   * Sugar: adapters map → register-all → frozen registry.
   * Map keys must equal each adapter's `name`.
   */
  private static buildRegistryFromMap(
    gateways: Record<string, GatewayAdapter>,
  ): ImmutableGatewayRegistry<GatewayMap> {
    let builder = createGatewayRegistry();
    for (const [key, adapter] of Object.entries(gateways)) {
      if (!adapter || typeof adapter !== "object") {
        throw new InvalidRequestError(
          `gateways['${key}'] must be a GatewayAdapter`,
        );
      }
      if (key !== adapter.name) {
        throw new InvalidRequestError(
          `Gateways map key '${key}' must match adapter.name '${adapter.name}'`,
        );
      }
      builder = builder.register(adapter);
    }
    return builder.build();
  }

  /**
   * Require non-empty secrets when a gateway config object is present.
   * Webhook secrets are optional and not checked here.
   * Adapter factories validate their own config on the plugin path.
   */
  private static assertGatewayCredentials(config: PaymentClientConfig): void {
    const nonEmpty = (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0;

    if (config.moyasar !== undefined) {
      if (!nonEmpty(config.moyasar.secretKey)) {
        throw new InvalidRequestError(
          "moyasar.secretKey must be a non-empty string",
        );
      }
    }

    if (config.stripe !== undefined) {
      if (!nonEmpty(config.stripe.secretKey)) {
        throw new InvalidRequestError(
          "stripe.secretKey must be a non-empty string",
        );
      }
    }

    if (config.paypal !== undefined) {
      if (!nonEmpty(config.paypal.clientId)) {
        throw new InvalidRequestError(
          "paypal.clientId must be a non-empty string",
        );
      }
      if (!nonEmpty(config.paypal.clientSecret)) {
        throw new InvalidRequestError(
          "paypal.clientSecret must be a non-empty string",
        );
      }
    }

    if (config.paymob !== undefined) {
      const hasSecretKey = nonEmpty(config.paymob.secretKey);
      const hasApiKey = nonEmpty(config.paymob.apiKey);
      if (!hasSecretKey && !hasApiKey) {
        throw new InvalidRequestError(
          "paymob requires secretKey or apiKey as a non-empty string",
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Gateway Access
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a specific gateway instance by registered name.
   *
   * With {@link createPaymentClient}, only registered keys are accepted at the
   * type level. Legacy `new PaymentClient` defaults to {@link BuiltInGatewayMap}
   * so all four first-party names type-check (missing ones still throw at runtime).
   *
   * @throws {GatewayNotConfiguredError} If gateway is not configured
   */
  gateway<K extends keyof TGateways & string>(name: K): TGateways[K] {
    const gw = this.gateways.get(name);
    if (!gw) {
      throw new GatewayNotConfiguredError(name);
    }
    return gw as TGateways[K];
  }

  /**
   * Get list of configured gateway names (registration order when built from registry).
   */
  configuredGateways(): Array<keyof TGateways & string> {
    return Array.from(this.gateways.keys()) as Array<keyof TGateways & string>;
  }

  /**
   * Check if a gateway is configured (accepts any string for open registries).
   */
  hasGateway(name: string): boolean {
    return this.gateways.has(name);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Payment Operations (Convenience Methods)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a payment using the specified or default gateway.
   *
   * Single-arg calls use {@link CreatePaymentParams} (callbackUrl required at the
   * type level). Gateway-specific overloads relax fields where the provider allows
   * (e.g. Stripe callbackUrl optional when calling with gateway: "stripe").
   */
  async createPayment(
    params: StripeCreatePaymentParams,
    gateway: "stripe" & (keyof TGateways & string),
  ): Promise<GatewayPaymentResult>;
  async createPayment(
    params: MoyasarCreatePaymentParams,
    gateway: "moyasar" & (keyof TGateways & string),
  ): Promise<GatewayPaymentResult>;
  async createPayment(
    params: PayPalCreatePaymentParams,
    gateway: "paypal" & (keyof TGateways & string),
  ): Promise<GatewayPaymentResult>;
  async createPayment(
    params: PaymobCreatePaymentParams,
    gateway: "paymob" & (keyof TGateways & string),
  ): Promise<GatewayPaymentResult>;
  async createPayment(
    params: CreatePaymentParams,
    gateway?: keyof TGateways & string,
  ): Promise<GatewayPaymentResult>;
  async createPayment(
    params:
      | CreatePaymentParams
      | StripeCreatePaymentParams
      | MoyasarCreatePaymentParams
      | PayPalCreatePaymentParams
      | PaymobCreatePaymentParams,
    gateway?: keyof TGateways & string,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    // Capability claims are authoritative when a Phase 3 surface is present.
    // Includes authorization (capture:false) and marketplaceSplits so
    // non-BaseGateway adapters cannot skip those on the facade.
    for (const capability of requiredCapabilitiesForOperation(
      "createPayment",
      params,
    )) {
      this.assertCapability(gw, capability, "createPayment");
    }
    return gw.createPayment(params as CreatePaymentParams);
  }

  /**
   * Capture an authorized payment.
   *
   * Full capture (no `amount`) is not gated by `partialCapture`. When `amount`
   * is provided and the gateway claims `partialCapture: false`, throws
   * {@link OperationNotSupportedError} with capability `partialCapture`.
   */
  async capturePayment(
    params: CaptureParams,
    gateway?: keyof TGateways & string,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    for (const capability of requiredCapabilitiesForOperation(
      "capturePayment",
      params,
    )) {
      this.assertCapability(gw, capability, "capturePayment");
    }
    return gw.capturePayment(params);
  }

  /**
   * Refund a payment (full or partial).
   *
   * When a capability surface is present:
   * - `refunds: false` blocks all refunds
   * - `partialRefunds: false` blocks refunds that pass `amount` (full refund ok)
   */
  async refundPayment(
    params: RefundParams,
    gateway?: keyof TGateways & string,
  ): Promise<GatewayRefundResult> {
    const gw = this.resolveGateway(gateway);
    for (const capability of requiredCapabilitiesForOperation(
      "refundPayment",
      params,
    )) {
      this.assertCapability(gw, capability, "refundPayment");
    }
    return gw.refundPayment(params);
  }

  /**
   * Void/cancel an authorized payment before capture.
   *
   * @throws {OperationNotSupportedError} If the gateway does not claim `voids`
   *   (when a capability surface is present) or does not implement `voidPayment`.
   *   Claims are authoritative: `voids: false` fails even if a method exists.
   */
  async voidPayment(
    params: VoidParams,
    gateway?: keyof TGateways & string,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    // Claims first when present (authoritative even if a method exists).
    for (const capability of requiredCapabilitiesForOperation(
      "voidPayment",
      params,
    )) {
      this.assertCapability(gw, capability, "voidPayment");
    }
    if (typeof gw.voidPayment !== "function") {
      // Method missing: include capability metadata when a Phase 3 surface exists
      // (claim may be true but method absent — surface the mismatch).
      throw new OperationNotSupportedError(
        gw.name,
        "voidPayment",
        hasCapabilitySurface(gw)
          ? {
              capability: "voids",
              claimedSupport: gw.supports("voids"),
            }
          : undefined,
      );
    }
    return gw.voidPayment(params);
  }

  /**
   * Retrieve payment details from a gateway.
   * Not a separate capability key — method presence only.
   *
   * @throws {OperationNotSupportedError} If the gateway does not implement getPayment
   */
  async getPayment(
    params: GetPaymentParams,
    gateway?: keyof TGateways & string,
  ): Promise<GatewayPaymentResult> {
    const gw = this.resolveGateway(gateway);
    if (typeof gw.getPayment !== "function") {
      throw new OperationNotSupportedError(gw.name, "getPayment");
    }
    return gw.getPayment(params);
  }

  /**
   * Get current status of a payment from a gateway.
   * Not a separate capability key — method presence only.
   *
   * @throws {OperationNotSupportedError} If the gateway does not implement getPaymentStatus
   */
  async getPaymentStatus(
    gatewayId: string,
    gateway?: keyof TGateways & string,
  ): Promise<PaymentStatus> {
    const gw = this.resolveGateway(gateway);
    if (typeof gw.getPaymentStatus !== "function") {
      throw new OperationNotSupportedError(gw.name, "getPaymentStatus");
    }
    return gw.getPaymentStatus(gatewayId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Handling
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle an incoming webhook from a payment gateway
   *
   * Stages:
   * 1. `onWebhookReceived` (untrusted payload; failures logged, never block)
   * 2. Signature / authenticity verification — failures call `onWebhookFailed`
   * 3. Parse / normalize — failures throw without calling `onWebhookFailed`
   * 4. Dual-write Phase 7 `PaymentEvent` if `event` is missing or not v1
   * 5. `onWebhookVerified` (trusted event; failures rethrown for provider retry)
   *
   * Return type remains {@link WebhookEvent} (0.x). Prefer discrimination via
   * `event.event?.type` or `webhookEventToPaymentEvent(event).type`. Hook
   * signatures are unchanged.
   *
   * @param gateway - Which gateway sent the webhook
   * @param payload - Raw webhook payload
   * @param signatureOrHeaders - Optional signature, or headers for gateways like PayPal
   * @param headers - Optional headers when signature is passed separately
   * @returns Normalized WebhookEvent (with Phase 7 dual-write fields when mappable)
   * @throws {InvalidWebhookError} If verification fails, or parse fails with an untyped error
   * @throws {InvalidRequestError} If a gateway parse path rejects the payload shape
   */
  async handleWebhook(
    gateway: keyof TGateways & string,
    payload: unknown,
    signatureOrHeaders?: string | Record<string, string>,
    headers?: Record<string, string>,
  ): Promise<WebhookEvent> {
    const gw = this.gateway(gateway);

    // Notify hooks that a webhook was received.
    // ⚠️ This fires on the UNVERIFIED payload (verification happens below), so
    // onWebhookReceived must stay side-effect-free (logging/metrics only).
    // State-changing logic belongs in onWebhookVerified, which only runs after
    // verification succeeds. Failures here are logged and never block verify.
    try {
      await this.hooksManager.runWebhookReceived(gateway, payload);
    } catch (hookError) {
      this.logger.error("onWebhookReceived hook failed", {
        gateway,
        hookError:
          hookError instanceof Error ? hookError.message : String(hookError),
      });
    }

    // ── Stage: verify (onWebhookFailed only for verification failures) ──────
    try {
      const signature =
        typeof signatureOrHeaders === "string" ? signatureOrHeaders : undefined;
      const verificationHeaders =
        typeof signatureOrHeaders === "string" ? headers : signatureOrHeaders;
      // CORE-3: if verifyWebhookAsync is absent, still boolean-check
      // verifyWebhook. A Promise must not count as verified — await it.
      let isVerified: unknown = gw.verifyWebhookAsync
        ? await gw.verifyWebhookAsync(payload, signatureOrHeaders, headers)
        : gw.verifyWebhook(payload, signature, verificationHeaders);
      if (isThenable(isVerified)) {
        isVerified = await isVerified;
      }
      if (isVerified !== true) {
        throw new InvalidWebhookError("Webhook verification failed");
      }
    } catch (error) {
      const primaryError =
        error instanceof Error ? error : new Error(String(error));

      // Secondary hook failures must not replace the primary verification error
      try {
        await this.hooksManager.runWebhookFailed(payload, primaryError);
      } catch (hookError) {
        this.logger.error("onWebhookFailed hook failed", {
          gateway,
          hookError:
            hookError instanceof Error ? hookError.message : String(hookError),
          originalError: primaryError.message,
        });
      }

      throw primaryError;
    }

    // ── Stage: parse (separate from verify; do not call onWebhookFailed) ────
    // WEBHOOKS-1: after successful verify, never throw InvalidWebhookError.
    // Forgery-class errors stop provider redelivery (~400). Parse/shape failures
    // on authentic payloads must surface as InvalidRequestError so inbox engines
    // map them to retryable/server outcomes and paid events redeliver.
    let event: WebhookEvent;
    try {
      event = gw.parseWebhookEvent(payload);
    } catch (error) {
      if (error instanceof InvalidRequestError) {
        throw error;
      }
      const detail =
        error instanceof Error ? error.message : String(error);
      // Reclassify gateway InvalidWebhookError / unknown throws as parse errors.
      throw new InvalidRequestError(
        error instanceof InvalidWebhookError
          ? detail
          : `Webhook parse failed: ${detail}`,
      );
    }

    // Safety net: built-in gateways already attach a v1 PaymentEvent (with
    // gateway-specific mapContext + payloadHash). Rebuild when `event` is
    // missing or not a valid schemaVersion-1 PaymentEvent. Do not overwrite
    // richer valid dual-write. After rebuild, apply Stripe incomplete-money /
    // incomplete-refund demotes for stripe-like snapshots (P610-SAFE-1).
    const dualWrite = event.event;
    if (
      dualWrite === undefined ||
      !isPaymentEvent(dualWrite) ||
      dualWrite.schemaVersion !== PAYMENT_EVENT_SCHEMA_VERSION
    ) {
      event = attachPaymentEvent(event, { computePayloadHash: true });
      event = demoteIncompleteRefundWebhookDualWrite(
        demoteIncompleteSettledWebhookDualWrite(event),
      );
    }

    // CORE-2: hooks receive a deep clone. Mutations to status/amount/ids/stableType
    // must not rewrite the verified event returned to callers (false fulfillment).
    const forHooks = cloneWebhookEventForHooks(event);

    // Verified path: onWebhookVerified failures are rethrown so the HTTP
    // handler can return 5xx and the provider will retry. Log first so the
    // failure is visible even if the caller swallows the error. (Unlike
    // onWebhookFailed, we do not swallow — fulfillment must not silently skip.)
    try {
      await this.hooksManager.runWebhookVerified(forHooks);
    } catch (hookError) {
      this.logger.error("onWebhookVerified hook failed", {
        gateway,
        hookError:
          hookError instanceof Error ? hookError.message : String(hookError),
      });
      throw hookError;
    }

    return event;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Runtime Hook Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a hook at runtime
   */
  addHook<K extends keyof PaymentHooks>(
    name: K,
    handler: PaymentHooks[K],
  ): void {
    this.hooksManager.register(name, handler);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Throw {@link OperationNotSupportedError} with capability metadata when the
   * gateway exposes a Phase 3 surface and does not claim `capability`.
   *
   * Legacy gateways without `capabilities`/`supports` are a no-op here so
   * optional-method duck-typing remains the 0.x fallback.
   */
  private assertCapability(
    gw: PaymentGateway,
    capability: GatewayCapabilityKey,
    operation: string,
  ): void {
    if (!hasCapabilitySurface(gw)) {
      return;
    }
    if (!gw.supports(capability)) {
      throw new OperationNotSupportedError(gw.name, operation, {
        capability,
        claimedSupport: false,
      });
    }
  }

  /**
   * CORE-1: re-assert partialCapture / partialRefunds after before-hooks mutate
   * params so hook-injected `amount` cannot bypass capability:false.
   * Runs as a post-before guard (always after every before-hook chain).
   */
  private installPartialMoneyCapabilityGuards(): void {
    this.hooksManager.registerPostBeforeGuard((ctx) => {
      if (ctx.operation !== "capturePayment" && ctx.operation !== "refundPayment") {
        return;
      }
      const params = ctx.params as { amount?: unknown } | undefined;
      if (params === undefined || params === null || typeof params !== "object") {
        return;
      }
      if (params.amount === undefined) {
        return;
      }
      const gw = this.gateways.get(String(ctx.gateway));
      if (!gw) {
        return;
      }
      if (ctx.operation === "capturePayment") {
        this.assertCapability(gw, "partialCapture", "capturePayment");
      } else {
        this.assertCapability(gw, "partialRefunds", "refundPayment");
      }
    });
  }

  /**
   * Resolve which gateway to use
   * @throws {InvalidRequestError} If neither an explicit nor a default gateway is available
   * @throws {GatewayNotConfiguredError} If the resolved gateway is not configured
   */
  private resolveGateway(
    gateway?: keyof TGateways & string,
  ): PaymentGateway {
    const name = gateway ?? this.defaultGateway;

    if (!name) {
      throw new InvalidRequestError(
        "No gateway specified and no default gateway configured",
      );
    }

    return this.gateway(name);
  }
}
