// file: packages/payments/src/types/config.types.ts

import type { GatewayName } from './payment.types';
import type { PaymentHooks } from '../hooks/hooks.types';
import type { IdempotencyStore } from '../utils/idempotency';
import type { Logger } from '../utils/logger';
import type { GatewayAdapter } from '../gateways/gateway-adapter';
import type { GatewayMap, ImmutableGatewayRegistry } from '../gateways/gateway-registry';
import type { PaymentGateway } from '../gateways/gateway.interface';
import type { PaymentRuntime } from '../runtime/payment-runtime';

/**
 * Moyasar gateway configuration
 */
export interface MoyasarConfig {
    /** Secret API key */
    secretKey: string;
    /**
     * Publishable key — client-side only (e.g. Moyasar.js tokenization).
     * Not used by this SDK backend.
     */
    publishableKey?: string;
    /**
     * @deprecated Ignored. Moyasar test vs live is determined solely by the
     * secret key prefix (`sk_test_…` vs `sk_live_…`), not a sandbox flag.
     * Kept only for config-shape compatibility with other gateways.
     */
    sandbox?: boolean;
    /** Webhook secret for verification */
    webhookSecret?: string;
    /** Request timeout in milliseconds. Default: 30000 */
    timeoutMs?: number;
    /**
     * Optional injectable idempotency store for refund/capture/void. Moyasar's
     * API has no native idempotency for these endpoints, so without a store a
     * retried refund can refund the customer twice. Provide a process-wide
     * store (Redis/SQL, ideally with an atomic `reserve`) for full protection;
     * an in-memory store only dedupes within a single process.
     */
    idempotencyStore?: IdempotencyStore;
}

/**
 * PayPal gateway configuration
 */
export interface PayPalConfig {
    /** Client ID */
    clientId: string;
    /** Client Secret */
    clientSecret: string;
    /** Use sandbox environment */
    sandbox?: boolean;
    /** Webhook ID for verification */
    webhookId?: string;
    /** Request timeout in milliseconds. Default: 30000 */
    timeoutMs?: number;
}

/**
 * Paymob region identifiers.
 * - `ksa`, `eg`, `om`, `ae` — supported official regional hosts
 * - `pk` — **experimental / unofficial**; base URL is kept for compatibility but
 *   is not guaranteed against current Paymob Pakistan docs. Prefer an explicit
 *   `baseUrl` if your account uses a different host.
 */
export type PaymobRegion = 'ksa' | 'eg' | 'pk' | 'om' | 'ae';

export type MaybePromise<T> = T | Promise<T>;

export interface PaymobIdempotencyRecord {
    fingerprint: string;
    status: 'in_progress' | 'completed' | 'unknown';
    createdAt: number;
    expiresAt: number;
    result?: unknown;
}

export interface PaymobIdempotencyStore {
    /**
     * Optional atomic reservation. Implement with Redis SET NX, a database unique
     * constraint, or equivalent to prevent duplicate cross-worker API calls.
     * Return an existing record when the key is already reserved, otherwise store
     * the supplied in-progress record and return undefined.
     */
    reserve?(key: string, record: PaymobIdempotencyRecord): MaybePromise<PaymobIdempotencyRecord | undefined>;
    get(key: string): MaybePromise<PaymobIdempotencyRecord | undefined>;
    set(key: string, record: PaymobIdempotencyRecord): MaybePromise<void>;
    delete(key: string): MaybePromise<void>;
}

/**
 * Paymob gateway configuration (KSA Unified Intention API)
 * @see https://developers.paymob.com/ksa/getting-started-ksa
 */
export interface PaymobConfig {
    /**
     * Secret key for Unified Intention API authorization and preferred auth for
     * post-pay management APIs (capture, refund, void, transaction inquiry)
     * via `Authorization: Token ${secretKey}`.
     */
    secretKey?: string;
    /** Public key used to launch Unified Checkout */
    publicKey?: string;
    /** HMAC secret for webhook verification */
    hmacSecret?: string;
    /**
     * Allow Paymob webhooks without HMAC verification.
     * Intended only for local development; ignored when NODE_ENV=production.
     * Production should configure hmacSecret.
     */
    allowUnverifiedWebhooks?: boolean;
    /**
     * Region (determines base URL). Default: `'ksa'`.
     * `'pk'` is experimental/unofficial — the SDK keeps `https://pakistan.paymob.com`
     * for backward compatibility but does not guarantee it against current Paymob
     * Pakistan documentation. Prefer an explicit `baseUrl` when your account host differs.
     */
    region?: PaymobRegion;
    /** Optional base URL override (takes precedence over region) */
    baseUrl?: string;
    /** Integration ID or payment method alias used by the Intention API */
    integrationId?: string | number;
    /**
     * Integration ID/payment method alias for Paymob auth/capture flows.
     * Used when createPayment receives capture: false and no per-request
     * paymobIntegrationId/paymobPaymentMethods override is provided.
     */
    authIntegrationId?: string | number;
    /** Legacy iframe ID, required only for deprecated iframe checkout flow */
    iframeId?: string | number;
    /** Request timeout in milliseconds. Default: 30000 */
    timeoutMs?: number;
    /**
     * Optional shared idempotency store for Paymob operations. Configure this with
     * Redis, a database, or another process-wide store when running multiple
     * workers. Implement reserve atomically for full cross-worker protection.
     * Without it, idempotency is scoped to one gateway instance.
     */
    idempotencyStore?: PaymobIdempotencyStore;
    /**
     * Optional per-currency minor-unit exponent overrides for amount conversion
     * (create, capture, refund, webhooks mapping). Keys are ISO 4217 codes
     * (case-insensitive lookup prefers uppercase). Defaults to ISO 4217 via
     * `getCurrencyExponent` (e.g. OMR → 3). Merchants on Paymob Oman (or other
     * regions) whose account expects non-ISO scaling should set overrides only
     * after confirming with Paymob — e.g. `{ OMR: 3 }` or `{ OMR: 2 }` if their
     * account documents two-decimal OMR.
     */
    currencyExponentOverrides?: Record<string, number>;

    // ═══════════════════════════════════════════════════════════════════════════
    // Legacy fields (deprecated, for backward compat with Egypt API)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Legacy API key used to exchange `/api/auth/tokens` for auth tokens.
     * Required for deprecated iframe checkout. Optional fallback for capture,
     * refund, void, and transaction inquiry when `secretKey` is not set.
     */
    apiKey?: string;
}

/**
 * Stripe gateway configuration
 */
export interface StripeConfig {
    /** Stripe Secret API Key */
    secretKey: string;
    /**
     * Stripe publishable key — client-side only (e.g. Stripe.js / Elements).
     * Not used by this SDK backend.
     */
    publishableKey?: string;
    /** Webhook signing secret */
    webhookSecret?: string;
    /** API version (optional, defaults to the SDK's pinned Stripe API version) */
    apiVersion?: string;
    /**
     * Expected webhook endpoint API version. When set, `parseWebhookEvent` rejects
     * snapshot events whose `api_version` does not match. Not set by default and
     * does not fall back to `apiVersion` or the SDK pin — omit to accept any
     * webhook API version Stripe delivers.
     */
    webhookApiVersion?: string;
    /** Request timeout in milliseconds. Default: 30000 */
    timeoutMs?: number;
}

/**
 * Base gateway configuration - generic record type
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GatewayConfig = Record<string, any>;

/**
 * Legacy `new PaymentClient({ moyasar, stripe, ... })` configuration.
 *
 * @deprecated Prefer {@link CreatePaymentClientOptions} with
 * `createPaymentClient({ gateways | registry })` and first-party adapters
 * (`stripeGateway`, `moyasarGateway`, …). This shape remains supported
 * through 0.x for migration.
 */
export interface PaymentClientConfig {
    /** Moyasar gateway configuration */
    moyasar?: MoyasarConfig;
    /** PayPal gateway configuration */
    paypal?: PayPalConfig;
    /** Paymob gateway configuration */
    paymob?: PaymobConfig;
    /** Stripe gateway configuration */
    stripe?: StripeConfig;

    /** Global lifecycle hooks */
    hooks?: PaymentHooks;

    /** Default gateway to use when not specified */
    defaultGateway?: GatewayName;

    /**
     * Optional logger. All gateway logging is routed through this and secrets/PII
     * are redacted before being passed to it. Defaults to a no-op (the SDK is
     * silent unless a logger is provided).
     */
    logger?: Logger;

    /**
     * Optional portable runtime overrides (fetch / crypto / clock / randomUUID).
     * Forwarded to each built-in gateway constructor (Phase 8). Prefer
     * `createPaymentClient({ runtime })` for the plugin path.
     * Omit keys (exactOptionalPropertyTypes) rather than assigning `undefined`.
     */
    runtime?: Partial<PaymentRuntime>;
}

/**
 * Map of gateway name → adapter. Keys must equal each adapter's `name`.
 * Used by {@link CreatePaymentClientOptions.gateways}.
 */
export type GatewayAdaptersMap<TMap extends GatewayMap = GatewayMap> = {
    [K in keyof TMap & string]: GatewayAdapter<K, TMap[K] & PaymentGateway<K>>;
};

/**
 * Preferred client construction options for {@link createPaymentClient}.
 *
 * Provide **exactly one** of `registry` or `gateways` (not both, not neither).
 * Do not mix these fields with legacy `PaymentClientConfig` provider keys —
 * use `new PaymentClient({...})` for the deprecated path only.
 *
 * @typeParam TMap - Inferred map of gateway name → instance type
 */
export type CreatePaymentClientOptions<TMap extends GatewayMap = GatewayMap> = {
    /**
     * Pre-built immutable registry (from `createGatewayRegistry().register(...).build()`).
     * Mutually exclusive with {@link gateways}.
     */
    registry?: ImmutableGatewayRegistry<TMap>;
    /**
     * Adapters keyed by gateway name (sugar for register-all then build).
     * Each map key must equal `adapter.name`. Mutually exclusive with {@link registry}.
     */
    gateways?: GatewayAdaptersMap<TMap> | Record<string, GatewayAdapter>;
    /** Default gateway when ops omit an explicit name */
    defaultGateway?: keyof TMap & string;
    /** Global lifecycle hooks */
    hooks?: PaymentHooks;
    /**
     * Optional logger. Routed through a redacting wrapper before hooks/context.
     * Defaults to a no-op.
     */
    logger?: Logger;
    /**
     * Optional portable runtime overrides (fetch / crypto / clock / randomUUID).
     * Merged into {@link GatewayContext} for all adapters created by this client.
     * Omit keys (exactOptionalPropertyTypes) rather than assigning `undefined`.
     *
     * @example
     * ```ts
     * createPaymentClient({
     *   gateways: { stripe: stripeGateway({ secretKey: 'sk_…' }) },
     *   runtime: { fetch: customFetch, clock: fakeClock },
     * });
     * ```
     */
    runtime?: Partial<PaymentRuntime>;
};
