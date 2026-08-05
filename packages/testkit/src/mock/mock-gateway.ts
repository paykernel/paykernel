/**
 * Scriptable mock PaymentGateway for application tests and conformance golden path.
 *
 * Behaviors:
 * - FIFO scripted outcomes per operation (last-step / defaultOutcome after drain)
 * - latencyMs / delayMs (FakeClock advances virtually; otherwise real setTimeout)
 * - AbortSignal cancellation, timeout / network_error / indeterminate
 * - provider-side success + client-side timeout dual outcome
 * - partial capture/refund with over-capture / over-refund rejection
 * - redacted request history + assertHistory
 * - HMAC webhook sign / verify + duplicate / out-of-order helpers
 *
 * Never hits real networks. NON-PRODUCTION test double only.
 */

import {
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  CardDeclinedError,
  createRedactingLogger,
  defineGatewayCapabilities,
  freezeCapabilities,
  fromMinorUnits,
  GatewayApiError,
  getCurrencyExponent,
  InsufficientFundsError,
  InvalidRequestError,
  isMoney,
  minorAmountToNumber,
  moneyToMajorNumber,
  NetworkError,
  noopLogger,
  normalizeAmountInput,
  OperationNotSupportedError,
  redact,
  toMinorUnits,
  type AmountInput,
  type CaptureParams,
  type CreatePaymentParams,
  type GatewayCapabilities,
  type GatewayCapabilityKey,
  type GatewayPaymentResult,
  type GatewayRefundResult,
  type GetPaymentParams,
  type Logger,
  type Money,
  type PaymentGateway,
  type PaymentOperationOutcome,
  type PaymentStatus,
  type RefundParams,
  type VoidParams,
  type WebhookEvent,
} from "@paykernel/core";

import type { Clock, FakeClock } from "../memory/fake-clock";
import type {
  HistoryAssertion,
  MockRequestRecord,
  ScriptedPaymentOutcome,
  ScriptedRefundOutcome,
  ScriptedThrowStep,
} from "./outcomes";
import {
  defaultPaymentResult,
  defaultRefundResult,
  paymentStatusToOperationOutcome,
  stepDelayMs,
} from "./outcomes";
import {
  computeMockWebhookSignature,
  createMockWebhookPayload,
  DEFAULT_MOCK_WEBHOOK_SECRET,
  generateDuplicateWebhooks,
  generateOutOfOrderWebhooks,
  generateWebhookEvent,
  mockPayloadToWebhookEvent,
  outOfOrderWebhooks,
  signMockWebhook,
  signWebhook,
  withDuplicateWebhook,
  type MockWebhookPayload,
  type SignMockWebhookOptions,
} from "./webhook-helpers";

/**
 * Pure conversion options for test helpers (allow zero/negative so the helper
 * is not charge-policy; charge paths use {@link resolveChargeAmount} instead).
 */
const CONVERSION_OPTS = {
  allowZero: true,
  allowNegative: true,
} as const;

/**
 * Convert major units → integer minor units via core bigint helpers.
 * Does **not** use `amount * 10**n` float math.
 *
 * Accepts deprecated `number` majors or {@link Money}. Excess precision is
 * rejected (same default as `@paykernel/core` money model).
 */
export function majorToMinor(
  amount: number | Money,
  currency: string,
): number {
  const code = isMoney(amount) ? amount.currency : currency;
  const m = normalizeAmountInput(amount, code, CONVERSION_OPTS);
  return minorAmountToNumber(toMinorUnits(m, CONVERSION_OPTS));
}

/**
 * Convert integer minor units → major-unit JS number via core helpers.
 * Prefer {@link Money} / minor integers for financial logic; the returned
 * number is for legacy result shapes and test assertions only.
 */
export function minorToMajor(minor: number, currency: string): number {
  const m = fromMinorUnits(minor, currency, CONVERSION_OPTS);
  return moneyToMajorNumber(m, CONVERSION_OPTS);
}

/**
 * Normalize a charge/capture/refund amount at the mock boundary.
 * Uses shared money primitives (strict precision; non-zero by default).
 */
function resolveChargeAmount(
  amount: AmountInput,
  currency: string,
): { major: number; minor: number; money: Money } {
  const m = normalizeAmountInput(amount, currency);
  return {
    money: m,
    major: moneyToMajorNumber(m),
    minor: minorAmountToNumber(toMinorUnits(m)),
  };
}

export type MockGatewayOptions = {
  name?: string;
  capabilities?: GatewayCapabilities | Partial<Record<GatewayCapabilityKey, boolean>>;
  /** Queue of outcomes for createPayment (FIFO). Default: always succeeded. */
  createPayment?: ScriptedPaymentOutcome[];
  capturePayment?: ScriptedPaymentOutcome[];
  refundPayment?: ScriptedRefundOutcome[];
  voidPayment?: ScriptedPaymentOutcome[];
  getPayment?: ScriptedPaymentOutcome[];
  /**
   * Outcome used when a queue is empty and no last step was consumed.
   * When omitted, empty queues fall back to last-step replay or synthetic success.
   */
  defaultOutcome?: ScriptedPaymentOutcome;
  /** Shared secret for mock webhook signatures (test-only placeholder). */
  webhookSecret?: string;
  /** Default latency for operations without per-outcome latencyMs/delayMs. */
  defaultLatencyMs?: number;
  /**
   * Injectable clock. When a FakeClock is provided, delays advance the clock
   * virtually (no real wait) for deterministic tests; timestamps use the clock.
   */
  clock?: Clock | FakeClock;
  /**
   * When true, operations honor AbortSignal on params if present via
   * testkit extension `signal` (for cancellation tests). Default true.
   */
  respectAbort?: boolean;
  /**
   * Optional logger (wrapped with {@link createRedactingLogger}).
   * Used by conformance `logging_redaction` and app tests.
   */
  logger?: Logger;
  /**
   * When true (default), same `idempotencyKey` on createPayment returns the
   * same gatewayId without double-charging (process-local map only).
   */
  honorIdempotencyKey?: boolean;
};

/**
 * In-memory ledger. Amounts are tracked as integer **minor** units for
 * capture/refund remaining math (no float epsilon). {@link getPaymentState}
 * still exposes major-unit numbers for test inspection / conformance.
 */
type PaymentStateInternal = {
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  capturedAmountMinor: number;
  refundedAmountMinor: number;
  authorized: boolean;
};

/** Public ledger snapshot (major units) returned by {@link MockGateway.getPaymentState}. */
export type PaymentState = {
  amount: number;
  currency: string;
  status: PaymentStatus;
  capturedAmount: number;
  refundedAmount: number;
  authorized: boolean;
};

function toPublicPaymentState(state: PaymentStateInternal): PaymentState {
  return {
    amount: minorToMajor(state.amountMinor, state.currency),
    currency: state.currency,
    status: state.status,
    capturedAmount: minorToMajor(state.capturedAmountMinor, state.currency),
    refundedAmount: minorToMajor(state.refundedAmountMinor, state.currency),
    authorized: state.authorized,
  };
}

export type MockGateway = PaymentGateway & {
  /**
   * Frozen snapshot of recorded operations (redacted params/results).
   * Each read is a new copy; mutating it does not affect the mock ledger.
   */
  readonly history: readonly MockRequestRecord[];
  /** Same as {@link history}: frozen snapshot of the request ledger. */
  getHistory(): readonly MockRequestRecord[];
  /** Clear request history. */
  clearHistory(): void;
  /**
   * Assert history contains expected operations in order (partial match).
   * Throws Error with detail when mismatch.
   */
  assertHistory(expected: HistoryAssertion[]): void;
  /** Remaining scripted outcomes per operation (queued only, not last-step). */
  remainingOutcomes(): Record<string, number>;
  /** Push additional outcomes at runtime. */
  enqueue(
    operation:
      | "createPayment"
      | "capturePayment"
      | "refundPayment"
      | "voidPayment"
      | "getPayment",
    outcome: ScriptedPaymentOutcome | ScriptedRefundOutcome,
  ): void;
  /**
   * Dual-outcome: provider recorded success but client sees timeout/NetworkError.
   * Returns the provider-side result for reconciliation tests.
   */
  getLastProviderSideSuccess(): GatewayPaymentResult | undefined;
  /** Build a signed mock webhook payload. */
  buildWebhook(
    overrides?: Partial<MockWebhookPayload>,
    signOptions?: SignMockWebhookOptions,
  ): MockWebhookPayload;
  /** signWebhook(payload, secret?) → signature string */
  signWebhook(payload: unknown, secret?: string): string;
  /** generateWebhookEvent helper bound to this mock name/secret. */
  generateWebhookEvent: typeof generateWebhookEvent;
  generateDuplicateWebhooks: typeof generateDuplicateWebhooks;
  generateOutOfOrderWebhooks: typeof generateOutOfOrderWebhooks;
  /** Duplicate + out-of-order helpers (legacy names). */
  webhookHelpers: {
    withDuplicate: typeof withDuplicateWebhook;
    outOfOrder: typeof outOfOrderWebhooks;
    sign: typeof signMockWebhook;
    computeSignature: typeof computeMockWebhookSignature;
    signWebhook: typeof signWebhook;
    generateWebhookEvent: typeof generateWebhookEvent;
    generateDuplicateWebhooks: typeof generateDuplicateWebhooks;
    generateOutOfOrderWebhooks: typeof generateOutOfOrderWebhooks;
  };
  /** In-memory payment ledger (test inspection). */
  getPaymentState(gatewayPaymentId: string): PaymentState | undefined;
  /** Replace logger at runtime (always redacting). */
  setLogger(logger: Logger): void;
};

function asCapabilities(
  input?: GatewayCapabilities | Partial<Record<GatewayCapabilityKey, boolean>>,
): GatewayCapabilities {
  if (!input) {
    return freezeCapabilities(
      defineGatewayCapabilities({
        payments: true,
        immediateCapture: true,
        authorization: true,
        partialCapture: true,
        refunds: true,
        partialRefunds: true,
        voids: true,
        hostedCheckout: false,
      }),
    );
  }
  if (
    typeof (input as GatewayCapabilities).payments === "boolean" &&
    Object.keys(input).length >= 15
  ) {
    return freezeCapabilities(input as GatewayCapabilities);
  }
  return freezeCapabilities(defineGatewayCapabilities(input));
}

function isFakeClock(clock: Clock | FakeClock | undefined): clock is FakeClock {
  return (
    !!clock &&
    typeof (clock as FakeClock).advance === "function" &&
    typeof (clock as FakeClock).set === "function"
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new NetworkError("Request aborted", signal.reason));
      return;
    }
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new NetworkError("Request aborted", signal?.reason));
    };
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isThrowStep(
  step: ScriptedPaymentOutcome | ScriptedRefundOutcome | undefined,
): step is ScriptedThrowStep {
  return !!step && "throw" in step && step.throw !== undefined;
}

/**
 * History error summary: name + optional code only.
 * Never stores raw Error.message / stacks (may carry tokens or card fragments).
 */
function errorSummary(err: unknown): MockRequestRecord["error"] {
  if (err instanceof Error) {
    const code =
      "code" in err && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : undefined;
    return code
      ? { name: err.name, message: "[REDACTED]", code }
      : { name: err.name, message: "[REDACTED]" };
  }
  return { name: "Error", message: "[REDACTED]" };
}

/**
 * True when a resolved gateway result should settle the mock money ledger.
 * Non-success outcomes (failed / indeterminate / requires_action / declined)
 * must not mutate captured/refunded/void state even if fallback computed them.
 */
function isLedgerSettlingResult(result: GatewayPaymentResult): boolean {
  if (result.outcome === "succeeded") return true;
  if (
    result.outcome === "failed" ||
    result.outcome === "indeterminate" ||
    result.outcome === "requires_action" ||
    result.outcome === "declined"
  ) {
    return false;
  }
  // Legacy results without Phase 6 outcome: only settle paid-like / known
  // post-settlement statuses (never pending/processing from success:true alone).
  return (
    result.status === "paid" ||
    result.status === "partially_captured" ||
    result.status === "cancelled" ||
    result.status === "authorized" ||
    result.status === "refunded" ||
    result.status === "partially_refunded"
  );
}

function partialMatch(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (typeof expected !== "object" || expected === null) {
    return Object.is(actual, expected);
  }
  if (typeof actual !== "object" || actual === null) return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) return false;
    return expected.every((item, i) => partialMatch(actual[i], item));
  }
  const exp = expected as Record<string, unknown>;
  const act = actual as Record<string, unknown>;
  for (const key of Object.keys(exp)) {
    if (!partialMatch(act[key], exp[key])) return false;
  }
  return true;
}

/**
 * Create a scriptable mock gateway implementing PaymentGateway.
 */
export function mockGateway(options: MockGatewayOptions = {}): MockGateway {
  const name = options.name ?? "mock";
  const capabilities = asCapabilities(options.capabilities);
  const webhookSecret = options.webhookSecret ?? DEFAULT_MOCK_WEBHOOK_SECRET;
  const defaultLatencyMs = options.defaultLatencyMs ?? 0;
  const clock = options.clock;
  const defaultOutcome = options.defaultOutcome;
  let logger: Logger = createRedactingLogger(options.logger ?? noopLogger);

  const queues = {
    createPayment: [...(options.createPayment ?? [])] as ScriptedPaymentOutcome[],
    capturePayment: [...(options.capturePayment ?? [])] as ScriptedPaymentOutcome[],
    refundPayment: [...(options.refundPayment ?? [])] as ScriptedRefundOutcome[],
    voidPayment: [...(options.voidPayment ?? [])] as ScriptedPaymentOutcome[],
    getPayment: [...(options.getPayment ?? [])] as ScriptedPaymentOutcome[],
  };

  const lastStep: {
    createPayment?: ScriptedPaymentOutcome;
    capturePayment?: ScriptedPaymentOutcome;
    refundPayment?: ScriptedRefundOutcome;
    voidPayment?: ScriptedPaymentOutcome;
    getPayment?: ScriptedPaymentOutcome;
  } = {};

  const history: MockRequestRecord[] = [];
  const payments = new Map<string, PaymentStateInternal>();
  /**
   * Idempotency key → completed createPayment result (process-local).
   * Includes provider-side dual-timeout successes so retries never double-charge.
   */
  const idempotencyResults = new Map<string, GatewayPaymentResult>();
  /**
   * In-flight createPayment promises by idempotency key.
   * Prevents concurrent same-key creates from racing past the cache check
   * (await on latency always yields a microtask even when delay is 0).
   */
  const idempotencyInflight = new Map<string, Promise<GatewayPaymentResult>>();
  let seq = 0;
  let lastProviderSideSuccess: GatewayPaymentResult | undefined;
  const honorIdempotencyKey = options.honorIdempotencyKey !== false;

  const nowMs = () => (clock ? clock.nowMs() : Date.now());

  function nextId(prefix: string): string {
    seq += 1;
    return `${prefix}_${name}_${seq}`;
  }

  function takePaymentStep(
    op: keyof typeof lastStep & keyof typeof queues,
  ): ScriptedPaymentOutcome | undefined {
    const q = queues[op] as ScriptedPaymentOutcome[];
    if (q.length > 0) {
      const step = q.shift()!;
      lastStep[op] = step as never;
      return step;
    }
    if (defaultOutcome) return defaultOutcome;
    return lastStep[op] as ScriptedPaymentOutcome | undefined;
  }

  function takeRefundStep(): ScriptedRefundOutcome | undefined {
    if (queues.refundPayment.length > 0) {
      const step = queues.refundPayment.shift()!;
      lastStep.refundPayment = step;
      return step;
    }
    if (defaultOutcome && isThrowStep(defaultOutcome)) {
      return defaultOutcome;
    }
    if (defaultOutcome && !isThrowStep(defaultOutcome)) {
      // Map payment default outcomes that are valid for refund scripting
      const o = defaultOutcome.outcome;
      const refundable = new Set([
        "succeeded",
        "network_error",
        "timeout",
        "gateway_api_error",
        "indeterminate",
        "failed",
        "custom",
      ]);
      if (typeof o === "string" && refundable.has(o)) {
        return defaultOutcome as ScriptedRefundOutcome;
      }
    }
    return lastStep.refundPayment;
  }

  async function applyLatency(
    step: { latencyMs?: number; delayMs?: number; respectAbort?: boolean } | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    const ms = stepDelayMs(step, defaultLatencyMs);
    const respect = step?.respectAbort ?? options.respectAbort ?? true;
    const effectiveSignal = respect ? signal : undefined;

    if (ms <= 0) {
      if (effectiveSignal?.aborted) {
        throw new NetworkError("Request aborted", effectiveSignal.reason);
      }
      return;
    }

    if (isFakeClock(clock)) {
      if (effectiveSignal?.aborted) {
        throw new NetworkError("Request aborted", effectiveSignal.reason);
      }
      clock.advance(ms);
      return;
    }

    await sleep(ms, effectiveSignal);
  }

  function getSignal(params: unknown): AbortSignal | undefined {
    if (params && typeof params === "object" && "signal" in params) {
      const s = (params as { signal?: unknown }).signal;
      if (s instanceof AbortSignal) return s;
    }
    return undefined;
  }

  async function track<T>(
    operation: MockRequestRecord["operation"],
    params: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    const redactedParams = redact(params);
    try {
      const result = await fn();
      const rec: MockRequestRecord = {
        operation,
        params: redactedParams,
        result: redact(result),
        atMs: nowMs(),
      };
      history.push(rec);
      logger.debug(`mock.${operation}`, {
        operation,
        result: rec.result as Record<string, unknown> | undefined,
      });
      return result;
    } catch (err) {
      const summary = errorSummary(err);
      const rec: MockRequestRecord = {
        operation,
        params: redactedParams,
        atMs: nowMs(),
      };
      if (summary) rec.error = summary;
      history.push(rec);
      logger.debug(`mock.${operation}.error`, {
        operation,
        error: summary as unknown as Record<string, unknown>,
      });
      throw err;
    }
  }

  function handleThrowStep(step: ScriptedThrowStep): never {
    if (step.throw === "abort") {
      throw new NetworkError("Request aborted (scripted)");
    }
    throw step.throw;
  }

  /**
   * Dual-write Phase 6 `outcome` + `references` (+ reconciliationRequired)
   * onto a gateway result while preserving legacy flat fields.
   */
  function withPhase6Outcome(
    result: GatewayPaymentResult,
    outcome: PaymentOperationOutcome,
    extras?: {
      decline?: NonNullable<GatewayPaymentResult["decline"]>;
      message?: string;
      action?: NonNullable<GatewayPaymentResult["nextAction"]>;
      reconciliationRequired?: boolean;
    },
  ): GatewayPaymentResult {
    const base: Parameters<typeof applyOutcomeToGatewayResult>[0] = {
      gatewayId: result.gatewayId,
      status: result.status,
      rawResponse: result.rawResponse,
      gateway: name,
      redirectUrl: result.redirectUrl,
    };
    if (result.gatewayObjectId !== undefined) {
      base.gatewayObjectId = result.gatewayObjectId;
    }
    if (result.orderId !== undefined) base.orderId = result.orderId;
    if (result.captureId !== undefined) base.captureId = result.captureId;
    if (result.authorizationId !== undefined) {
      base.authorizationId = result.authorizationId;
    }
    if (result.amount !== undefined) base.amount = result.amount;
    if (result.fee !== undefined) base.fee = result.fee;
    if (result.capturedAmount !== undefined) {
      base.capturedAmount = result.capturedAmount;
    }
    if (result.refundedAmount !== undefined) {
      base.refundedAmount = result.refundedAmount;
    }
    if (result.clientSecret !== undefined) {
      base.clientSecret = result.clientSecret;
    }
    if (result.nextAction !== undefined) base.nextAction = result.nextAction;
    // Always rebuild references from current status/ids so a paid fallback
    // spread cannot leave stale normalizedStatus after outcome remapping.
    if (result.decline !== undefined) base.decline = result.decline;
    if (result.providerRequestId !== undefined) {
      base.providerRequestId = result.providerRequestId;
    }
    return applyOutcomeToGatewayResult(base, outcome, extras);
  }

  function applyResultOverrides(
    base: GatewayPaymentResult,
    step: ScriptedPaymentOutcome | undefined,
  ): GatewayPaymentResult {
    if (!step || isThrowStep(step)) return base;
    let next = { ...base };
    if (step.amount !== undefined) next.amount = step.amount;
    if (step.status !== undefined) next.status = step.status;
    if ("result" in step && step.result) {
      next = { ...next, ...step.result };
    }
    // Re-seal Phase 6 identity after partial merges (unless caller set outcome).
    if (next.outcome === undefined || next.references === undefined) {
      const sealed = withPhase6Outcome(
        next,
        next.outcome ?? paymentStatusToOperationOutcome(next.status),
        next.reconciliationRequired === true
          ? { reconciliationRequired: true }
          : undefined,
      );
      // Preserve explicit reconciliationRequired / decline from overrides
      if (next.reconciliationRequired === true) {
        sealed.reconciliationRequired = true;
      }
      if (next.decline !== undefined) {
        sealed.decline = next.decline;
      }
      return sealed;
    }
    return next;
  }

  function ensurePaymentLedger(
    id: string,
    params: { amount: AmountInput; currency: string },
    result: GatewayPaymentResult,
    resolved?: { major: number; minor: number },
  ): void {
    if (!result.gatewayId) return;
    const key = result.gatewayId;
    const currency = params.currency;
    if (payments.has(key)) {
      const state = payments.get(key)!;
      state.status = result.status;
      if (result.capturedAmount !== undefined) {
        state.capturedAmountMinor = majorToMinor(
          result.capturedAmount,
          currency,
        );
      }
      if (result.refundedAmount !== undefined) {
        state.refundedAmountMinor = majorToMinor(
          result.refundedAmount,
          currency,
        );
      }
      return;
    }
    const amountMinor =
      resolved?.minor ??
      (result.amount !== undefined
        ? majorToMinor(result.amount, currency)
        : majorToMinor(params.amount as number | Money, currency));
    // Only paid settles full capture by default. partially_captured without an
    // explicit capturedAmount fails closed to 0 (incomplete money snapshot).
    // pending / requires_action / authorized / processing / failed → 0 capture
    // even when deprecated success:true (API-ok is not money settled).
    let capturedMinor: number;
    if (result.capturedAmount !== undefined) {
      capturedMinor = majorToMinor(result.capturedAmount, currency);
    } else if (result.status === "paid") {
      capturedMinor = amountMinor;
    } else {
      capturedMinor = 0;
    }
    const refundedMinor =
      result.refundedAmount !== undefined
        ? majorToMinor(result.refundedAmount, currency)
        : 0;
    payments.set(key, {
      amountMinor,
      currency,
      status: result.status,
      capturedAmountMinor: capturedMinor,
      refundedAmountMinor: refundedMinor,
      authorized: result.status === "authorized",
    });
    // Also map generated id if different
    if (id !== key && !payments.has(id)) {
      payments.set(id, payments.get(key)!);
    }
  }

  async function resolvePaymentOutcome(
    outcome: ScriptedPaymentOutcome | undefined,
    fallback: () => GatewayPaymentResult,
    signal?: AbortSignal,
    ledgerOnProviderSuccess?: (result: GatewayPaymentResult) => void,
  ): Promise<GatewayPaymentResult> {
    await applyLatency(outcome, signal);

    if (!outcome) {
      return fallback();
    }

    if (isThrowStep(outcome)) {
      handleThrowStep(outcome);
    }

    if (outcome.outcome === "custom") {
      if (outcome.error) throw outcome.error;
      if (outcome.result) return outcome.result;
      return fallback();
    }

    const dualTimeout =
      outcome.outcome === "provider_ok_client_timeout" ||
      outcome.outcome === "provider_success_client_timeout";

    switch (outcome.outcome) {
      case "declined":
        throw new CardDeclinedError(outcome.message ?? "Card declined (mock)");
      case "insufficient_funds":
        throw new InsufficientFundsError(
          outcome.message ?? "Insufficient funds (mock)",
        );
      case "network_error":
        throw new NetworkError(outcome.message ?? "Network error (mock)");
      case "timeout":
        // Transport-level indeterminate: never map to definitive failure at provider
        throw new NetworkError(outcome.message ?? "Request timed out (mock)");
      case "gateway_api_error":
        throw new GatewayApiError(
          outcome.message ?? "Gateway API error (mock)",
          name,
        );
      case "provider_ok_client_timeout":
      case "provider_success_client_timeout": {
        // Provider ledger: paid + outcome succeeded; client still times out.
        const paidBase = { ...fallback(), status: "paid" as PaymentStatus };
        const providerResult = applyResultOverrides(
          withPhase6Outcome(paidBase, "succeeded"),
          outcome,
        );
        lastProviderSideSuccess = providerResult;
        ledgerOnProviderSuccess?.(providerResult);
        throw new NetworkError(
          outcome.message ??
            "Client timeout after provider-side success (mock; reconcile via getLastProviderSideSuccess)",
        );
      }
      case "indeterminate": {
        // Explicit Phase 6 arm — never looks like a card decline or paid.
        const base = fallback();
        const status = outcome.status ?? "processing";
        return applyResultOverrides(
          withPhase6Outcome(
            {
              ...base,
              status,
              rawResponse: {
                mock: true,
                status,
                error: {
                  code: "INDETERMINATE",
                  message:
                    outcome.message ??
                    "Payment outcome indeterminate (mock); reconciliation required",
                },
                reconciliationRequired: true,
              },
            },
            "indeterminate",
          ),
          outcome,
        );
      }
      case "failed":
        return applyResultOverrides(
          withPhase6Outcome(
            { ...fallback(), status: "failed" },
            "failed",
          ),
          outcome,
        );
      case "succeeded":
        return applyResultOverrides(
          withPhase6Outcome({ ...fallback(), status: "paid" }, "succeeded"),
          outcome,
        );
      case "authorized":
        return applyResultOverrides(
          withPhase6Outcome(
            { ...fallback(), status: "authorized" },
            "succeeded",
          ),
          outcome,
        );
      case "requires_action": {
        const nextAction = {
          type: "redirect" as const,
          url: "https://mock.test/3ds",
        };
        return applyResultOverrides(
          withPhase6Outcome(
            {
              ...fallback(),
              status: "pending",
              redirectUrl: "https://mock.test/3ds",
              nextAction,
            },
            "requires_action",
            { action: nextAction },
          ),
          outcome,
        );
      }
      case "pending":
        return applyResultOverrides(
          withPhase6Outcome(
            { ...fallback(), status: "pending" },
            "requires_action",
          ),
          outcome,
        );
      case "processing":
        return applyResultOverrides(
          withPhase6Outcome(
            { ...fallback(), status: "processing" },
            "requires_action",
          ),
          outcome,
        );
      case "partial_capture":
        return applyResultOverrides(
          withPhase6Outcome(
            { ...fallback(), status: "partially_captured" },
            "succeeded",
          ),
          outcome,
        );
      case "voided":
        return applyResultOverrides(
          withPhase6Outcome(
            { ...fallback(), status: "cancelled" },
            "succeeded",
          ),
          outcome,
        );
      default: {
        // Exhaustiveness: dualTimeout already handled; seal fallback with Phase 6
        void dualTimeout;
        const fb = fallback();
        return withPhase6Outcome(
          fb,
          fb.outcome ?? paymentStatusToOperationOutcome(fb.status),
        );
      }
    }
  }

  const gateway: MockGateway = {
    name,
    capabilities,
    supports(capability: GatewayCapabilityKey): boolean {
      return capabilities[capability] === true;
    },

    setLogger(next: Logger) {
      logger =
        next && next !== noopLogger ? createRedactingLogger(next) : noopLogger;
    },

    get history() {
      // Snapshot + freeze so callers cannot mutate the internal ledger.
      return Object.freeze([...history]);
    },

    getHistory() {
      return Object.freeze([...history]);
    },

    clearHistory() {
      history.length = 0;
    },

    assertHistory(expected: HistoryAssertion[]) {
      let hi = 0;
      for (let i = 0; i < expected.length; i++) {
        const exp = expected[i]!;
        let found = false;
        while (hi < history.length) {
          const rec = history[hi]!;
          hi += 1;
          if (rec.operation !== exp.operation) continue;
          if (exp.params !== undefined && !partialMatch(rec.params, exp.params)) {
            continue;
          }
          if (exp.result !== undefined && !partialMatch(rec.result, exp.result)) {
            continue;
          }
          if (exp.error !== undefined) {
            if (exp.error === true) {
              if (!rec.error) continue;
            } else if (exp.error === false) {
              if (rec.error) continue;
            } else {
              if (!rec.error) continue;
              if (exp.error.name && rec.error.name !== exp.error.name) continue;
              if (exp.error.code && rec.error.code !== exp.error.code) continue;
            }
          }
          found = true;
          break;
        }
        if (!found) {
          throw new Error(
            `assertHistory: expected entry #${i} (${exp.operation}) not found in remaining history. ` +
              `History ops: [${history.map((h) => h.operation).join(", ")}]`,
          );
        }
      }
    },

    remainingOutcomes() {
      return {
        createPayment: queues.createPayment.length,
        capturePayment: queues.capturePayment.length,
        refundPayment: queues.refundPayment.length,
        voidPayment: queues.voidPayment.length,
        getPayment: queues.getPayment.length,
      };
    },

    enqueue(operation, outcome) {
      (queues[operation] as unknown[]).push(outcome);
    },

    getLastProviderSideSuccess() {
      return lastProviderSideSuccess;
    },

    buildWebhook(overrides = {}, signOptions = {}) {
      const base: Partial<MockWebhookPayload> = { ...overrides };
      if (base.createdAt === undefined && clock) {
        base.createdAt = new Date(clock.nowMs()).toISOString();
      }
      const payload = createMockWebhookPayload(base);
      return signMockWebhook(payload, {
        secret: signOptions.secret ?? webhookSecret,
        ...signOptions,
      });
    },

    signWebhook(payload: unknown, secret?: string) {
      return signWebhook(payload, secret ?? webhookSecret);
    },

    generateWebhookEvent(opts = {}) {
      const args: Parameters<typeof generateWebhookEvent>[0] = {
        gateway: name,
        secret: webhookSecret,
        ...opts,
      };
      if (args.createdAt === undefined && clock) {
        args.createdAt = new Date(clock.nowMs()).toISOString();
      }
      return generateWebhookEvent(args);
    },

    generateDuplicateWebhooks,
    generateOutOfOrderWebhooks,

    webhookHelpers: {
      withDuplicate: withDuplicateWebhook,
      outOfOrder: outOfOrderWebhooks,
      sign: signMockWebhook,
      computeSignature: computeMockWebhookSignature,
      signWebhook,
      generateWebhookEvent,
      generateDuplicateWebhooks,
      generateOutOfOrderWebhooks,
    },

    getPaymentState(id: string): PaymentState | undefined {
      const state = payments.get(id);
      return state ? toPublicPaymentState(state) : undefined;
    },

    async createPayment(params: CreatePaymentParams): Promise<GatewayPaymentResult> {
      return track("createPayment", params, async () => {
        if (!capabilities.payments) {
          throw new OperationNotSupportedError(name, "createPayment", {
            capability: "payments",
            claimedSupport: false,
          });
        }

        const resolved = resolveChargeAmount(params.amount, params.currency);
        const major = resolved.major;
        const minor = resolved.minor;

        const idemKey =
          honorIdempotencyKey && params.idempotencyKey
            ? params.idempotencyKey
            : undefined;

        // Process-local idempotency: same key → same gatewayId (no double-charge)
        if (idemKey && idempotencyResults.has(idemKey)) {
          const cached = idempotencyResults.get(idemKey)!;
          logger.info("createPayment idempotent replay", {
            gatewayId: cached.gatewayId,
            idempotencyKey: idemKey,
          });
          return { ...cached };
        }

        // Join in-flight same-key work so concurrent Promise.all does not charge twice.
        if (idemKey) {
          const pending = idempotencyInflight.get(idemKey);
          if (pending) {
            logger.info("createPayment idempotent join in-flight", {
              idempotencyKey: idemKey,
            });
            try {
              return { ...(await pending) };
            } catch (err) {
              // Dual-timeout caches provider success before throwing; prefer cache.
              if (idempotencyResults.has(idemKey)) {
                return { ...idempotencyResults.get(idemKey)! };
              }
              throw err;
            }
          }
        }

        const runCreate = async (): Promise<GatewayPaymentResult> => {
          const outcome = takePaymentStep("createPayment");
          const id = nextId("pay");
          const capture = params.capture !== false;
          const signal = getSignal(params);

          logger.info("createPayment", {
            amount: major,
            currency: params.currency,
            idempotencyKey: params.idempotencyKey,
            metadata: params.metadata,
          });

          /** Provider-side success under dual-timeout (client still throws). */
          let dualProviderResult: GatewayPaymentResult | undefined;

          try {
            // fallback builds result shape only — does NOT write paid/authorized ledger.
            // Success / processing / terminal failure write after resolve; dual-timeout
            // provider-side paid goes through ledgerOnProviderSuccess only.
            const result = await resolvePaymentOutcome(
              outcome,
              () => {
                const status: PaymentStatus =
                  !capture && capabilities.authorization ? "authorized" : "paid";
                return {
                  ...defaultPaymentResult(id, status, major, name),
                  rawResponse: {
                    mock: true,
                    amountMinor: minor,
                    currency: params.currency.toUpperCase(),
                    exponent: getCurrencyExponent(params.currency),
                  },
                };
              },
              signal,
              (providerResult) => {
                // Dual-outcome: provider applied success even though client times out
                const pid = providerResult.gatewayId || id;
                const withId = !providerResult.gatewayId
                  ? { ...providerResult, gatewayId: pid }
                  : providerResult;
                dualProviderResult = withId;
                const dualMajor = withId.amount ?? major;
                const dualMinor = majorToMinor(dualMajor, params.currency);
                const dualCapturedMajor =
                  withId.capturedAmount ?? withId.amount ?? major;
                payments.set(pid, {
                  amountMinor: dualMinor,
                  currency: params.currency,
                  status: withId.status ?? "paid",
                  capturedAmountMinor: majorToMinor(
                    dualCapturedMajor,
                    params.currency,
                  ),
                  refundedAmountMinor: 0,
                  authorized: false,
                });
                // Cache before throw so retries never double-charge
                if (idemKey && withId.gatewayId) {
                  idempotencyResults.set(idemKey, { ...withId });
                }
              },
            );

            // Prefer stable id from fallback when scripted result omitted gatewayId
            const finalResult = !result.gatewayId
              ? { ...result, gatewayId: id }
              : result;

            if (finalResult.success || finalResult.status === "processing") {
              ensurePaymentLedger(id, params, finalResult, { major, minor });
            } else {
              // Non-success terminal (e.g. failed): honest ledger — never leave paid hanging
              const key = finalResult.gatewayId || id;
              payments.set(key, {
                amountMinor: minor,
                currency: params.currency,
                status: finalResult.status,
                capturedAmountMinor: 0,
                refundedAmountMinor: 0,
                authorized: false,
              });
              if (id !== key && !payments.has(id)) {
                payments.set(id, payments.get(key)!);
              }
            }

            if (idemKey && finalResult.success && finalResult.gatewayId) {
              idempotencyResults.set(idemKey, { ...finalResult });
            }
            return finalResult;
          } catch (err) {
            // Dual-timeout: cache already set in ledger callback; rethrow client error.
            // Plain timeout/network without provider success: no cache (indeterminate).
            void dualProviderResult;
            throw err;
          }
        };

        if (!idemKey) {
          return runCreate();
        }

        const inflight = runCreate().finally(() => {
          idempotencyInflight.delete(idemKey);
        });
        idempotencyInflight.set(idemKey, inflight);
        return inflight;
      });
    },

    async capturePayment(params: CaptureParams): Promise<GatewayPaymentResult> {
      return track("capturePayment", params, async () => {
        const outcome = takePaymentStep("capturePayment");
        const signal = getSignal(params);
        const state = payments.get(params.gatewayPaymentId);
        // Defer ledger mutation until the resolved outcome is money-settling.
        // Scripted failed/indeterminate/requires_action must not change balances.
        let applyLedger: (() => void) | undefined;

        const result = await resolvePaymentOutcome(
          outcome,
          () => {
            if (!state) {
              throw new GatewayApiError(
                `Payment ${params.gatewayPaymentId} not found (mock)`,
                name,
              );
            }
            const remainingMinor =
              state.amountMinor - state.capturedAmountMinor;
            if (remainingMinor <= 0) {
              throw new InvalidRequestError(
                `Payment ${params.gatewayPaymentId} has no capturable amount remaining (mock)`,
              );
            }
            const currency = params.currency ?? state.currency;
            const captureMinor =
              params.amount !== undefined
                ? resolveChargeAmount(params.amount, currency).minor
                : remainingMinor;
            if (captureMinor <= 0) {
              throw new InvalidRequestError(
                `Capture amount must be positive (got ${minorToMajor(captureMinor, currency)}) (mock)`,
              );
            }
            if (captureMinor > remainingMinor) {
              throw new InvalidRequestError(
                `Over-capture: requested ${minorToMajor(captureMinor, currency)}, remaining capturable ${minorToMajor(remainingMinor, currency)} (mock)`,
              );
            }
            if (
              params.amount !== undefined &&
              captureMinor < remainingMinor &&
              !capabilities.partialCapture
            ) {
              throw new OperationNotSupportedError(name, "partialCapture", {
                capability: "partialCapture",
                claimedSupport: false,
              });
            }
            const nextCapturedMinor = state.capturedAmountMinor + captureMinor;
            const fullyCaptured = nextCapturedMinor >= state.amountMinor;
            const finalCapturedMinor = fullyCaptured
              ? state.amountMinor
              : nextCapturedMinor;
            const nextStatus: PaymentStatus = fullyCaptured
              ? "paid"
              : "partially_captured";
            const amountMajor = minorToMajor(state.amountMinor, state.currency);
            const capturedMajor = minorToMajor(
              finalCapturedMinor,
              state.currency,
            );
            applyLedger = () => {
              state.capturedAmountMinor = finalCapturedMinor;
              state.authorized = false;
              state.status = nextStatus;
            };
            return {
              ...defaultPaymentResult(
                params.gatewayPaymentId,
                nextStatus,
                amountMajor,
                name,
              ),
              capturedAmount: capturedMajor,
              amount: amountMajor,
            };
          },
          signal,
          // Dual-timeout: provider-side success must settle even though client throws.
          () => {
            applyLedger?.();
          },
        );

        if (applyLedger && isLedgerSettlingResult(result)) {
          applyLedger();
        }
        return result;
      });
    },

    async refundPayment(params: RefundParams): Promise<GatewayRefundResult> {
      return track("refundPayment", params, async () => {
        if (!capabilities.refunds) {
          throw new OperationNotSupportedError(name, "refundPayment", {
            capability: "refunds",
            claimedSupport: false,
          });
        }
        const outcome = takeRefundStep();
        const signal = getSignal(params);
        await applyLatency(outcome, signal);

        if (outcome && isThrowStep(outcome)) {
          handleThrowStep(outcome);
        }

        if (outcome?.outcome === "custom") {
          if (outcome.error) throw outcome.error;
          if (outcome.result) return outcome.result;
        }
        if (
          outcome?.outcome === "network_error" ||
          outcome?.outcome === "timeout"
        ) {
          throw new NetworkError(outcome.message ?? "Network error (mock)");
        }
        if (outcome?.outcome === "gateway_api_error") {
          throw new GatewayApiError(
            outcome.message ?? "Gateway API error (mock)",
            name,
          );
        }
        if (outcome?.outcome === "indeterminate") {
          return applyOutcomeToGatewayRefundResult(
            {
              gatewayRefundId: nextId("ref"),
              status: "pending",
              rawResponse: {
                mock: true,
                error: { code: "INDETERMINATE" },
                reconciliationRequired: true,
              },
            },
            "indeterminate",
          );
        }
        if (outcome?.outcome === "failed") {
          return applyOutcomeToGatewayRefundResult(
            {
              gatewayRefundId: nextId("ref"),
              status: "failed",
              rawResponse: { mock: true, status: "failed" },
            },
            "failed",
          );
        }

        const state = payments.get(params.gatewayPaymentId);
        if (!state) {
          throw new GatewayApiError(
            `Payment ${params.gatewayPaymentId} not found (mock)`,
            name,
          );
        }
        const remainingMinor =
          state.capturedAmountMinor - state.refundedAmountMinor;
        if (remainingMinor <= 0) {
          throw new InvalidRequestError(
            `Payment ${params.gatewayPaymentId} has no refundable amount remaining (mock)`,
          );
        }
        const currency = params.currency ?? state.currency;
        const refundMinor =
          params.amount !== undefined
            ? resolveChargeAmount(params.amount, currency).minor
            : remainingMinor;
        if (refundMinor <= 0) {
          throw new InvalidRequestError(
            `Refund amount must be positive (got ${minorToMajor(refundMinor, currency)}) (mock)`,
          );
        }
        if (refundMinor > remainingMinor) {
          throw new InvalidRequestError(
            `Over-refund: requested ${minorToMajor(refundMinor, currency)}, remaining refundable ${minorToMajor(remainingMinor, currency)} (mock)`,
          );
        }
        if (
          params.amount !== undefined &&
          refundMinor < remainingMinor &&
          !capabilities.partialRefunds
        ) {
          throw new OperationNotSupportedError(name, "partialRefund", {
            capability: "partialRefunds",
            claimedSupport: false,
          });
        }

        state.refundedAmountMinor += refundMinor;
        if (state.refundedAmountMinor >= state.capturedAmountMinor) {
          state.status = "refunded";
          state.refundedAmountMinor = state.capturedAmountMinor;
        } else {
          state.status = "partially_refunded";
        }

        const refundId = nextId("ref");
        // Ledger-derived totals are authoritative (TESTKIT-3). Scripted
        // `result` may add metadata but must not override reported money
        // fields after the ledger has already been mutated.
        const base = defaultRefundResult(
          refundId,
          "completed",
          minorToMajor(state.refundedAmountMinor, state.currency),
        );
        if (outcome?.outcome === "partial_refund" || outcome?.result) {
          const override = (outcome.result ?? {}) as Partial<GatewayRefundResult>;
          return {
            ...base,
            ...override,
            // Re-assert ledger-derived money identity after spread
            status: base.status,
            totalRefunded: base.totalRefunded,
            success: base.success,
            outcome: base.outcome,
            gatewayRefundId: override.gatewayRefundId ?? base.gatewayRefundId,
          };
        }
        return base;
      });
    },

    async voidPayment(params: VoidParams): Promise<GatewayPaymentResult> {
      return track("voidPayment", params, async () => {
        if (!capabilities.voids) {
          throw new OperationNotSupportedError(name, "voidPayment", {
            capability: "voids",
            claimedSupport: false,
          });
        }
        const outcome = takePaymentStep("voidPayment");
        const signal = getSignal(params);
        const state = payments.get(params.gatewayPaymentId);
        // Defer cancel mutation until outcome is money-settling (void success).
        let applyLedger: (() => void) | undefined;

        const result = await resolvePaymentOutcome(
          outcome,
          () => {
            if (state) {
              if (state.capturedAmountMinor > 0) {
                throw new InvalidRequestError(
                  `Cannot void payment ${params.gatewayPaymentId} after capture (mock)`,
                );
              }
              applyLedger = () => {
                state.status = "cancelled";
                state.authorized = false;
              };
            }
            return defaultPaymentResult(
              params.gatewayPaymentId,
              "cancelled",
              undefined,
              name,
            );
          },
          signal,
          () => {
            applyLedger?.();
          },
        );

        if (applyLedger && isLedgerSettlingResult(result)) {
          applyLedger();
        }
        return result;
      });
    },

    async getPayment(params: GetPaymentParams): Promise<GatewayPaymentResult> {
      return track("getPayment", params, async () => {
        const outcome = takePaymentStep("getPayment");
        const signal = getSignal(params);
        return resolvePaymentOutcome(
          outcome,
          () => {
            const state = payments.get(params.gatewayPaymentId);
            if (!state) {
              throw new GatewayApiError(
                `Payment ${params.gatewayPaymentId} not found (mock)`,
                name,
              );
            }
            const publicState = toPublicPaymentState(state);
            return {
              ...defaultPaymentResult(
                params.gatewayPaymentId,
                publicState.status,
                publicState.amount,
                name,
              ),
              capturedAmount: publicState.capturedAmount,
              refundedAmount: publicState.refundedAmount,
            };
          },
          signal,
        );
      });
    },

    async getPaymentStatus(gatewayId: string): Promise<PaymentStatus> {
      return track("getPaymentStatus", { gatewayId }, async () => {
        const state = payments.get(gatewayId);
        if (!state) {
          throw new GatewayApiError(
            `Payment ${gatewayId} not found (mock)`,
            name,
          );
        }
        return state.status;
      });
    },

    /**
     * Hosted checkout session (capability `hostedCheckout`).
     * Present so claim_method_presence passes when caps claim hostedCheckout.
     */
    async createCheckoutSession(params: unknown): Promise<unknown> {
      return track("createCheckoutSession", params, async () => {
        if (!capabilities.hostedCheckout) {
          throw new OperationNotSupportedError(name, "createCheckoutSession", {
            capability: "hostedCheckout",
            claimedSupport: false,
          });
        }
        const sessionId = nextId("cs");
        return {
          id: sessionId,
          url: `https://mock.test/checkout/${sessionId}`,
          status: "open",
          mock: true,
        };
      });
    },

    verifyWebhook(
      payload: unknown,
      signature?: string,
      _headers?: Record<string, string>,
    ): boolean {
      // Sync history for verify (no async track)
      const redactedParams = redact({ payload, signature });
      const push = (ok: boolean) => {
        history.push({
          operation: "verifyWebhook",
          params: redactedParams,
          result: { valid: ok },
          atMs: nowMs(),
        });
      };

      if (payload === null || payload === undefined) {
        push(false);
        return false;
      }
      if (typeof payload !== "object") {
        push(false);
        return false;
      }
      const body = payload as MockWebhookPayload & { signature?: string };
      // Sign over the payload without the signature field (HMAC body).
      const expected = computeMockWebhookSignature(
        { ...body, signature: undefined },
        webhookSecret,
      );
      // Prefer explicit signature arg; otherwise use body.signature.
      // Never accept "sig equals itself" — only compare to the computed HMAC.
      const sig = signature ?? body.signature;
      if (!sig) {
        push(false);
        return false;
      }
      const ok = sig === expected;
      push(ok);
      return ok;
    },

    parseWebhookEvent(payload: unknown): WebhookEvent {
      const redactedParams = redact(payload);
      try {
        if (payload === null || typeof payload !== "object") {
          throw new GatewayApiError("Invalid webhook payload (mock)", name);
        }
        const body = payload as MockWebhookPayload;
        if (!body.id || !body.gatewayPaymentId || !body.status) {
          throw new GatewayApiError("Malformed webhook payload (mock)", name);
        }
        const normalized: MockWebhookPayload = {
          id: body.id,
          type: body.type ?? "payment_paid",
          gatewayPaymentId: body.gatewayPaymentId,
          status: body.status,
        };
        if (body.paymentId !== undefined) normalized.paymentId = body.paymentId;
        if (body.amount !== undefined) normalized.amount = body.amount;
        if (body.currency !== undefined) normalized.currency = body.currency;
        if (body.createdAt !== undefined) normalized.createdAt = body.createdAt;
        if (body.signature !== undefined) normalized.signature = body.signature;
        if (body.sequence !== undefined) normalized.sequence = body.sequence;
        const evt = mockPayloadToWebhookEvent(normalized, name);
        history.push({
          operation: "parseWebhookEvent",
          params: redactedParams,
          result: redact(evt),
          atMs: nowMs(),
        });
        return evt;
      } catch (err) {
        const summary = errorSummary(err);
        const rec: MockRequestRecord = {
          operation: "parseWebhookEvent",
          params: redactedParams,
          atMs: nowMs(),
        };
        if (summary) rec.error = summary;
        history.push(rec);
        throw err;
      }
    },
  };

  return gateway;
}
