/**
 * Types for the capability-gated gateway conformance suite (Phase 4.1).
 */

import type {
  AmountInput,
  GatewayCapabilities,
  PaymentGateway,
  PaymentStatus,
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
    /** Prefer `money("10.50", "USD")`; plain `number` majors still accepted in 0.x. */
    amount: AmountInput;
    currency: string;
    callbackUrl: string;
    capture?: boolean;
  };
  /**
   * Amount conversion cases (major units in, major units out).
   * When omitted, suite uses a default set (USD 10.5 / JPY 100 / KWD 1.234)
   * for mock gateways. Amounts may be deprecated `number` or {@link AmountInput} Money.
   */
  amountCases?: Array<{
    amount: AmountInput;
    currency: string;
    /**
     * Expected major-unit amount on result.
     * Defaults to major number derived from `amount` (Money → major number).
     */
    expectedMajor?: number;
    /** Optional expected minor-unit amount (rawResponse.amountMinor when present). */
    expectedMinor?: number;
  }>;
  /**
   * Map of provider-native status strings to SDK {@link PaymentStatus}.
   * Used by status_normalization when the gateway exposes scripted statuses.
   */
  statusMap?: Record<string, PaymentStatus>;
  /** Webhook verification / parse fixtures (provider-shaped when testing built-ins). */
  webhook?: {
    validPayload: unknown;
    validSignature?: string;
    headers?: Record<string, string>;
    /** Explicit invalid signature for rejection tests. */
    invalidSignature?: string;
    malformedPayload?: unknown;
  };
  /** @deprecated Prefer amountCases; kept for callers that set expected minor. */
  expectedAmountMinor?: number;
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
