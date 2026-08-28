/**
 * Types for the capability-gated gateway conformance suite (Phase 4.1).
 */

import type {
  AmountInput,
  GatewayCapabilities,
  GatewayPaymentStatus,
  Money,
  PaymentGateway,
} from "@paykernel/core";

/**
 * Optional fixtures for amount, status, and webhook cases.
 * Built-in applicable mode only runs webhook cases when payload + signature
 * material is provided (never hits live provider APIs).
 */
export type GatewayConformanceFixtures = {
  /**
   * Create-payment params for happy-path cases.
   * Defaults to a safe synthetic payload (no secrets).
   */
  createPayment?: {
    amount: AmountInput;
    currency: string;
    callbackUrl: string;
    capture?: boolean;
  };
  /**
   * Amount conversion cases.
   * When omitted, suite uses a default set (KWD 1.200 padded, JPY 100 zero-decimal, SAR 10.50)
   * for mock gateways. Amounts are {@link Money} via `money("10.50", "SAR")`.
   * `expectedMajor` defaults to a copy of `amount` (Money).
   */
  amountCases?: Array<{
    amount: AmountInput;
    currency: string;
    /**
     * Expected major-unit amount on result as {@link Money}.
     * Defaults to `amount` when omitted.
     */
    expectedMajor?: Money;
    /** Optional expected minor-unit amount (rawResponse.amountMinor when present). */
    expectedMinor?: number;
  }>;
  /**
   * Map of provider-native status strings to SDK {@link GatewayPaymentStatus}.
   * Used by status_normalization when the gateway exposes scripted statuses.
   */
  statusMap?: Record<string, GatewayPaymentStatus>;
  /** Webhook verification / parse fixtures (provider-shaped when testing built-ins). */
  webhook?: {
    validPayload: unknown;
    validSignature?: string;
    headers?: Record<string, string>;
    /** Explicit invalid signature for rejection tests. */
    invalidSignature?: string;
    malformedPayload?: unknown;
  };
};

/**
 * Suite mode:
 * - `full` — all applicable cases (required for mockGateway golden path).
 * - `structural` — capabilities_parity + claim_method_presence only (no network).
 * - `applicable` — structural + offline-safe cases; skip provider HTTP unless
 *   the gateway is a scriptable mock (enqueue/history).
 */
export type GatewayConformanceMode = "full" | "structural" | "applicable";

export type GatewayConformanceOptions = {
  name: string;
  createGateway: () => PaymentGateway | Promise<PaymentGateway>;
  /**
   * Expected capability claims. Defaults to `gateway.capabilities` from the
   * first factory invocation when omitted.
   */
  capabilities?: GatewayCapabilities;
  fixtures?: GatewayConformanceFixtures;
  /** Skip suites that need live network / provider HTTP. Default: `full`. */
  mode?: GatewayConformanceMode;
  /** Optional: only run named cases (e.g. `amount_conversion`). */
  include?: string[];
  /** Optional: exclude named cases. */
  exclude?: string[];
  /**
   * When true (default false), throw if any case failed.
   * Prefer inspecting {@link GatewayConformanceReport.ok}.
   */
  throwOnFailure?: boolean;
};

export type GatewayConformanceReport = {
  name: string;
  passed: string[];
  failed: Array<{ case: string; error: string }>;
  skipped: Array<{ case: string; reason: string }>;
  ok: boolean;
};

/** Internal per-case result used while running the suite. */
export type GatewayConformanceCaseResult =
  | { name: string; status: "passed" }
  | { name: string; status: "failed"; error: string }
  | { name: string; status: "skipped"; reason: string };
