/**
 * Phase 6 — operation result helpers + domain type contracts (runtime + type).
 */
import { describe, it, expect } from "bun:test";
import type {
  CommonPaymentInput,
  GatewayPaymentResult,
  PaymentOperationResult,
  PaymentDomainStatus,
  AuthorizationStatus,
  CaptureStatus,
  RefundDomainStatus,
  SetupTokenStatus,
  DisputeStatus,
  TransferStatus,
  PayoutStatus,
  ProviderReferences,
  Payment,
} from "../index";
import {
  mapGatewayResultToOperationResult,
  applyOutcomeToGatewayResult,
  applyOutcomeToGatewayRefundResult,
  applyIndeterminatePaymentOutcome,
  applyIndeterminateRefundOutcome,
  isPaidOutcome,
  isRequiresActionOutcome,
  isIndeterminateOutcome,
  buildProviderReferences,
  inferOperationOutcome,
  successFromOutcome,
  successFromRefundOutcome,
  isPaymentDomainStatus,
  isPaidLikePaymentStatus,
  paymentFromGatewayResult,
  toPaymentErrorLike,
  paymentNextActionToAction,
  inferRefundOperationOutcome,
  mapGatewayRefundToOperationResult,
  isGatewayPaymentResult,
} from "../index";

/** Compile-time assignability (erased at runtime). */
function expectType<T>(_value: T): void {}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

function expectTypesEqual<A, B>(
  _ok: Equal<A, B> extends true ? true : never,
): void {}

// ─── 6.1 CommonPaymentInput has no provider keys ─────────────────────────────

type CommonKeys = keyof CommonPaymentInput;
type ForbiddenProviderKeys =
  | "stripePaymentMethodId"
  | "stripeCustomerId"
  | "stripeSetupFutureUsage"
  | "moyasarSource"
  | "tokenId"
  | "applyCoupon"
  | "returnUrl"
  | "cancelUrl"
  | "paypalShippingPreference"
  | "paymobIntegrationId"
  | "paymobPaymentMethods"
  | "paymobIframeId"
  | "paymobBillingData";

type CommonHasProviderKey = CommonKeys & ForbiddenProviderKeys;
expectTypesEqual<CommonHasProviderKey, never>(true);

const commonOnly: CommonPaymentInput = {
  amount: 10,
  orderId: "ord_1",
  description: "test",
  metadata: { a: 1 },
};
expectType<CommonPaymentInput>(commonOnly);

// ─── 6.2 Outcome arms are not mutually assignable ────────────────────────────

type SucceededArm = Extract<PaymentOperationResult, { outcome: "succeeded" }>;
type RequiresActionArm = Extract<
  PaymentOperationResult,
  { outcome: "requires_action" }
>;
type DeclinedArm = Extract<PaymentOperationResult, { outcome: "declined" }>;
type IndeterminateArm = Extract<
  PaymentOperationResult,
  { outcome: "indeterminate" }
>;

// @ts-expect-error — requires_action is not assignable to succeeded arm
const _reqAsSucceeded: SucceededArm = null! as RequiresActionArm;
void _reqAsSucceeded;

// @ts-expect-error — succeeded is not assignable to requires_action arm
const _succAsReq: RequiresActionArm = null! as SucceededArm;
void _succAsReq;

// @ts-expect-error — declined is not assignable to succeeded
const _decAsSucc: SucceededArm = null! as DeclinedArm;
void _decAsSucc;

// Indeterminate must carry reconciliationRequired: true
const indArm: IndeterminateArm = {
  outcome: "indeterminate",
  reconciliationRequired: true,
};
expectType<IndeterminateArm>(indArm);

// ─── 6.3 Domain status unions are distinct ───────────────────────────────────

expectType<PaymentDomainStatus>("paid");
expectType<AuthorizationStatus>("authorized");
expectType<CaptureStatus>("completed");
expectType<RefundDomainStatus>("pending");
expectType<SetupTokenStatus>("requires_action");
expectType<DisputeStatus>("won");
expectType<TransferStatus>("in_transit");
expectType<PayoutStatus>("paid");

// PaymentDomainStatus must not include setup_completed / refund_pending
// @ts-expect-error — setup_completed is legacy mega-union only
const _notDomain: PaymentDomainStatus = "setup_completed";
void _notDomain;
// @ts-expect-error — refund_pending is legacy mega-union only
const _notDomainRefund: PaymentDomainStatus = "refund_pending";
void _notDomainRefund;

// ─── Runtime helpers ─────────────────────────────────────────────────────────

function baseResult(
  overrides: Partial<GatewayPaymentResult> = {},
): GatewayPaymentResult {
  return {
    success: true,
    gatewayId: "pay_1",
    status: "paid",
    redirectUrl: undefined,
    rawResponse: {},
    ...overrides,
  };
}

describe("operation-result helpers", () => {
  it("maps paid status + success to outcome succeeded; isPaidOutcome true", () => {
    const result = baseResult({ status: "paid", success: true, amount: 10 });
    const op = mapGatewayResultToOperationResult(result, { gateway: "moyasar" });
    expect(op.outcome).toBe("succeeded");
    if (op.outcome !== "succeeded") throw new Error("expected succeeded");
    expect(op.payment.status).toBe("paid");
    expect(op.payment.references.providerObjectId).toBe("pay_1");
    expect(isPaidOutcome(result)).toBe(true);
    expect(isPaidOutcome(op)).toBe(true);
    expect(isRequiresActionOutcome(result)).toBe(false);
  });

  it("maps requires_action (nextAction + pending) and isPaidOutcome false", () => {
    const result = baseResult({
      success: true,
      status: "pending",
      redirectUrl: "https://example.com/3ds",
      nextAction: { type: "redirect", url: "https://example.com/3ds" },
    });
    const op = mapGatewayResultToOperationResult(result);
    expect(op.outcome).toBe("requires_action");
    if (op.outcome !== "requires_action") throw new Error("expected requires_action");
    expect(op.action.type).toBe("redirect");
    expect(isPaidOutcome(result)).toBe(false);
    expect(isRequiresActionOutcome(result)).toBe(true);
    expect(isRequiresActionOutcome(op)).toBe(true);
  });

  it("never maps pending/requires_action path to succeeded", () => {
    const pending = baseResult({
      success: true,
      status: "pending",
      clientSecret: "pi_secret",
    });
    expect(inferOperationOutcome(pending)).toBe("requires_action");
    expect(mapGatewayResultToOperationResult(pending).outcome).not.toBe(
      "succeeded",
    );
    expect(isPaidOutcome(pending)).toBe(false);

    const withAction = baseResult({
      success: true,
      status: "processing",
      nextAction: { type: "stcpay_otp", transactionUrl: "https://otp", method: "POST", parameter: "otp_value" },
    });
    expect(mapGatewayResultToOperationResult(withAction).outcome).toBe(
      "requires_action",
    );
  });

  it("maps declined with PaymentDecline", () => {
    const result = baseResult({
      success: false,
      status: "failed",
      decline: { code: "card_declined", message: "Card declined" },
    });
    const op = mapGatewayResultToOperationResult(result);
    expect(op.outcome).toBe("declined");
    if (op.outcome !== "declined") throw new Error("expected declined");
    expect(op.failure.code).toBe("card_declined");
    expect(isPaidOutcome(result)).toBe(false);
  });

  it("maps indeterminate markers to outcome indeterminate + reconciliationRequired", () => {
    const result = baseResult({
      success: false,
      status: "pending",
      reconciliationRequired: true,
      providerRequestId: "req_abc",
    });
    const op = mapGatewayResultToOperationResult(result);
    expect(op.outcome).toBe("indeterminate");
    if (op.outcome !== "indeterminate") throw new Error("expected indeterminate");
    expect(op.reconciliationRequired).toBe(true);
    expect(op.providerRequestId).toBe("req_abc");
    expect(isIndeterminateOutcome(result)).toBe(true);
    expect(isIndeterminateOutcome(op)).toBe(true);
    expect(isPaidOutcome(result)).toBe(false);

    const viaRaw = baseResult({
      success: false,
      status: "pending",
      rawResponse: { reconciliationRequired: true },
    });
    expect(inferOperationOutcome(viaRaw)).toBe("indeterminate");
  });

  it("applyOutcomeToGatewayResult dual-writes success from outcome", () => {
    const paid = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_1",
        status: "paid",
        rawResponse: { ok: true },
        amount: 25,
        gateway: "stripe",
      },
      "succeeded",
    );
    expect(paid.success).toBe(true);
    expect(paid.outcome).toBe("succeeded");
    expect(paid.references?.providerObjectId).toBe("pi_1");
    expect(paid.references?.gateway).toBe("stripe");
    expect(isPaidOutcome(paid)).toBe(true);

    const action = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_2",
        status: "pending",
        rawResponse: {},
        redirectUrl: "https://3ds",
        nextAction: { type: "redirect", url: "https://3ds" },
        gateway: "moyasar",
      },
      "requires_action",
    );
    expect(action.success).toBe(true);
    expect(action.outcome).toBe("requires_action");
    expect(isPaidOutcome(action)).toBe(false);

    const declined = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_3",
        status: "failed",
        rawResponse: {},
        gateway: "stripe",
      },
      "declined",
      { decline: { code: "generic_decline", message: "Declined" } },
    );
    expect(declined.success).toBe(false);
    expect(declined.outcome).toBe("declined");
    expect(declined.decline?.code).toBe("generic_decline");

    const ind = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_4",
        status: "pending",
        rawResponse: {},
        providerRequestId: "req_1",
        gateway: "paymob",
      },
      "indeterminate",
    );
    expect(ind.success).toBe(false);
    expect(ind.outcome).toBe("indeterminate");
    expect(ind.reconciliationRequired).toBe(true);
    expect(isIndeterminateOutcome(ind)).toBe(true);
  });

  it("P610-IND-1: network-error helpers emit indeterminate, not paid", () => {
    const payment = applyIndeterminatePaymentOutcome({
      gateway: "stripe",
      gatewayId: "pi_timeout",
      message: "Stripe API request timed out after 30000ms",
      errorName: "NetworkError",
    });
    expect(payment.outcome).toBe("indeterminate");
    expect(payment.reconciliationRequired).toBe(true);
    expect(payment.success).toBe(false);
    expect(isPaidOutcome(payment)).toBe(false);
    expect(isIndeterminateOutcome(payment)).toBe(true);

    const refund = applyIndeterminateRefundOutcome({
      gatewayRefundId: "re_timeout",
      message: "socket closed",
      errorName: "NetworkError",
    });
    expect(refund.outcome).toBe("indeterminate");
    expect(refund.reconciliationRequired).toBe(true);
    expect(refund.success).toBe(false);
  });

  it("successFromOutcome matches documented dual-write table", () => {
    expect(successFromOutcome("succeeded")).toBe(true);
    expect(successFromOutcome("requires_action")).toBe(true);
    expect(successFromOutcome("declined")).toBe(false);
    expect(successFromOutcome("failed")).toBe(false);
    expect(successFromOutcome("indeterminate")).toBe(false);
  });

  it("authorized success is not paid for fulfillment", () => {
    const result = baseResult({ success: true, status: "authorized" });
    // Operation may be succeeded (auth hold created) but not paid-like
    expect(inferOperationOutcome(result)).toBe("succeeded");
    expect(isPaidOutcome(result)).toBe(false);
    expect(isPaidLikePaymentStatus("authorized")).toBe(false);
    expect(isPaidLikePaymentStatus("paid")).toBe(true);
  });

  it("S20-SETUP-INFER: setup_completed + success is succeeded, not paid", () => {
    const extras: Array<Partial<GatewayPaymentResult>> = [
      {},
      { nextAction: { type: "redirect", url: "https://example.com/3ds" } },
    ];
    for (const extra of extras) {
      const result = baseResult({
        success: true,
        status: "setup_completed",
        ...extra,
      });
      expect(inferOperationOutcome(result)).toBe("succeeded");
      expect(isPaidOutcome(result)).toBe(false);
    }
    expect(isPaidLikePaymentStatus("setup_completed")).toBe(false);
    const op = mapGatewayResultToOperationResult(
      baseResult({ success: true, status: "setup_completed" }),
    );
    expect(op.outcome).toBe("succeeded");
    expect(isPaidOutcome(op)).toBe(false);
  });

  it("S20-FAILED-DECLINED: bare status failed without decline is failed", () => {
    const rows: Array<[Partial<GatewayPaymentResult>, "failed" | "declined"]> = [
      [{ success: false, status: "failed" }, "failed"],
      [{ success: true, status: "failed" }, "failed"],
      [
        {
          success: false,
          status: "failed",
          decline: { code: "card_declined", message: "nope" },
        },
        "declined",
      ],
      [{ success: false, status: "failed", outcome: "declined" }, "declined"],
    ];
    for (const [patch, outcome] of rows) {
      expect(inferOperationOutcome(baseResult(patch))).toBe(outcome);
    }
    const mapped = mapGatewayResultToOperationResult(
      baseResult({ success: false, status: "failed" }),
    );
    expect(mapped.outcome).toBe("failed");
    if (mapped.outcome === "failed") {
      expect(mapped.error.code).toBe("PAYMENT_FAILED");
    }
  });

  it("buyer pre-capture approved is not paid-like and not isPaidOutcome", () => {
    expect(isPaidLikePaymentStatus("approved")).toBe(false);
    expect(isPaidLikePaymentStatus("authorized")).toBe(false);

    const approved = baseResult({ success: true, status: "approved" });
    // Uncaptured approval must not look settled to poll / fulfillment helpers
    expect(inferOperationOutcome(approved)).toBe("requires_action");
    expect(isPaidOutcome(approved)).toBe(false);

    const op = mapGatewayResultToOperationResult(approved);
    expect(op.outcome).toBe("requires_action");
    expect(isPaidOutcome(op)).toBe(false);

    // Forced dual-write of outcome=succeeded still fails paid-like gate.
    const forced = baseResult({
      success: true,
      status: "approved",
      outcome: "succeeded",
    });
    expect(isPaidOutcome(forced)).toBe(false);
  });

  it("buildProviderReferences dual-writes related ids", () => {
    const refs: ProviderReferences = buildProviderReferences({
      gateway: "paypal",
      gatewayId: "ORDER-1",
      status: "pending",
      orderId: "ORDER-1",
      captureId: "CAP-1",
      authorizationId: "AUTH-1",
      internalReference: "merchant_ord_9",
      providerRequestId: "req_pp",
      providerNativeStatus: "CREATED",
    });
    expect(refs.providerObjectId).toBe("ORDER-1");
    expect(refs.gateway).toBe("paypal");
    expect(refs.normalizedStatus).toBe("pending");
    expect(refs.relatedIds?.orderId).toBe("ORDER-1");
    expect(refs.relatedIds?.captureId).toBe("CAP-1");
    expect(refs.relatedIds?.authorizationId).toBe("AUTH-1");
    expect(refs.internalReference).toBe("merchant_ord_9");
    expect(refs.providerRequestId).toBe("req_pp");
    expect(refs.providerNativeStatus).toBe("CREATED");
  });

  it("paymentFromGatewayResult uses existing references when present", () => {
    const references = buildProviderReferences({
      gateway: "stripe",
      gatewayId: "pi_x",
      status: "paid",
    });
    const result = baseResult({ references, gatewayId: "pi_x" });
    const payment: Payment = paymentFromGatewayResult(result);
    expect(payment.references).toBe(references);
  });

  it("isPaymentDomainStatus excludes legacy mega-union-only values", () => {
    expect(isPaymentDomainStatus("paid")).toBe(true);
    expect(isPaymentDomainStatus("pending")).toBe(true);
    expect(isPaymentDomainStatus("setup_completed")).toBe(false);
    expect(isPaymentDomainStatus("refund_pending")).toBe(false);
    expect(isPaymentDomainStatus("refund_completed")).toBe(false);
  });

  it("explicit outcome on GatewayPaymentResult wins over heuristics", () => {
    const result = baseResult({
      success: true,
      status: "paid",
      outcome: "indeterminate",
      reconciliationRequired: true,
    });
    expect(inferOperationOutcome(result)).toBe("indeterminate");
    expect(isPaidOutcome(result)).toBe(false);
  });

  it("reconciliationRequired blocks isPaidOutcome even with outcome succeeded (CORE-1)", () => {
    const result = baseResult({
      success: true,
      status: "paid",
      outcome: "succeeded",
      reconciliationRequired: true,
    });
    expect(inferOperationOutcome(result)).toBe("indeterminate");
    expect(isPaidOutcome(result)).toBe(false);

    const op = mapGatewayResultToOperationResult(result);
    expect(isPaidOutcome(op)).toBe(false);
  });

  it("cancelled status is not paid and not succeeded unless outcome forced", () => {
    const cancelled = baseResult({
      success: true,
      status: "cancelled",
    });
    expect(inferOperationOutcome(cancelled)).toBe("failed");
    expect(isPaidOutcome(cancelled)).toBe(false);

    const voided = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_void",
        status: "cancelled",
        rawResponse: {},
        gateway: "stripe",
      },
      "succeeded",
    );
    expect(voided.outcome).toBe("succeeded");
    expect(voided.status).toBe("cancelled");
    expect(isPaidOutcome(voided)).toBe(false);
  });

  it("CORE-1: Phase-6 preserves partial-capture requires_action (no upgrade to succeeded)", () => {
    // Gateways (Paymob/Stripe) demote partially_captured → requires_action.
    const partial = baseResult({
      success: true,
      status: "partially_captured",
      outcome: "requires_action",
      amount: 5,
      currency: "USD",
      capturedAmount: 5,
    });
    expect(inferOperationOutcome(partial)).toBe("requires_action");
    expect(mapGatewayResultToOperationResult(partial).outcome).toBe(
      "requires_action",
    );
    expect(isPaidOutcome(partial)).toBe(false);
    expect(isRequiresActionOutcome(partial)).toBe(true);

    // Paid + residual requires_action still upgrades (settled money wins).
    const paidWithAction = baseResult({
      success: true,
      status: "paid",
      outcome: "requires_action",
    });
    expect(inferOperationOutcome(paidWithAction)).toBe("succeeded");
    expect(isPaidOutcome(paidWithAction)).toBe(true);
  });

  it("P610-INF-1: bare partially_captured is open money (requires_action, not succeeded)", () => {
    const bare = baseResult({
      success: true,
      status: "partially_captured",
    });
    expect(inferOperationOutcome(bare)).toBe("requires_action");
    expect(mapGatewayResultToOperationResult(bare).outcome).toBe(
      "requires_action",
    );
    expect(isPaidOutcome(bare)).toBe(false);
    expect(isRequiresActionOutcome(bare)).toBe(true);
    expect(isPaidLikePaymentStatus("partially_captured")).toBe(false);

    // Settled-success statuses still infer operation succeeded (outcome only).
    expect(
      inferOperationOutcome(baseResult({ success: true, status: "paid" })),
    ).toBe("succeeded");
    expect(
      inferOperationOutcome(
        baseResult({ success: true, status: "authorized" }),
      ),
    ).toBe("succeeded");
    expect(
      inferOperationOutcome(baseResult({ success: true, status: "refunded" })),
    ).toBe("succeeded");
    expect(
      inferOperationOutcome(
        baseResult({ success: true, status: "partially_refunded" }),
      ),
    ).toBe("succeeded");
    expect(
      inferOperationOutcome(
        baseResult({ success: true, status: "setup_completed" }),
      ),
    ).toBe("succeeded");
    // isPaidOutcome stays paid-only — auth/refund settled ops are not fulfillment.
    expect(
      isPaidOutcome(baseResult({ success: true, status: "authorized" })),
    ).toBe(false);
    expect(
      isPaidOutcome(baseResult({ success: true, status: "refunded" })),
    ).toBe(false);
    expect(
      isPaidOutcome(
        baseResult({ success: true, status: "partially_refunded" }),
      ),
    ).toBe(false);
    expect(isPaidOutcome(baseResult({ success: true, status: "paid" }))).toBe(
      true,
    );
    expect(
      isPaidOutcome(baseResult({ success: true, status: "setup_completed" })),
    ).toBe(false);
  });

  it("P610-INF-2: success:false + pending/processing/approved is indeterminate, not failed", () => {
    for (const status of ["pending", "processing", "approved"] as const) {
      const result = baseResult({ success: false, status });
      expect(inferOperationOutcome(result)).toBe("indeterminate");
      const op = mapGatewayResultToOperationResult(result);
      expect(op.outcome).toBe("indeterminate");
      if (op.outcome === "indeterminate") {
        expect(op.reconciliationRequired).toBe(true);
      }
      expect(isPaidOutcome(result)).toBe(false);
      expect(isIndeterminateOutcome(result)).toBe(true);
    }

    // Definitive failure / decline paths stay closed.
    expect(
      inferOperationOutcome(
        baseResult({ success: false, status: "cancelled" }),
      ),
    ).toBe("failed");
    expect(
      inferOperationOutcome(baseResult({ success: false, status: "failed" })),
    ).toBe("failed");
  });

  it("CORE-INF-1: success:false + paid/authorized/partial/refunded is indeterminate, not failed", () => {
    const uncertain: Array<GatewayPaymentResult["status"]> = [
      "paid",
      "authorized",
      "partially_captured",
      "refunded",
      "partially_refunded",
    ];
    for (const status of uncertain) {
      const result = baseResult({ success: false, status });
      expect(inferOperationOutcome(result)).toBe("indeterminate");
      const op = mapGatewayResultToOperationResult(result);
      expect(op.outcome).toBe("indeterminate");
      if (op.outcome === "indeterminate") {
        expect(op.reconciliationRequired).toBe(true);
      }
      expect(isPaidOutcome(result)).toBe(false);
      expect(isIndeterminateOutcome(result)).toBe(true);
    }

    // Omitted success is the same hole (falsy success, settled snapshot).
    expect(
      inferOperationOutcome({
        gatewayId: "pay_omit",
        status: "paid",
        redirectUrl: undefined,
        rawResponse: {},
      } as GatewayPaymentResult),
    ).toBe("indeterminate");
  });

  it("NEW-CORE-9: success:false + refund_completed/refund_pending/reversed is indeterminate", () => {
    const uncertain: Array<GatewayPaymentResult["status"]> = [
      "refund_completed",
      "refund_pending",
      "reversed",
    ];
    for (const status of uncertain) {
      const result = baseResult({ success: false, status });
      expect(inferOperationOutcome(result)).toBe("indeterminate");
      const op = mapGatewayResultToOperationResult(result);
      expect(op.outcome).toBe("indeterminate");
      if (op.outcome === "indeterminate") {
        expect(op.reconciliationRequired).toBe(true);
      }
      expect(isPaidOutcome(result)).toBe(false);
      expect(isIndeterminateOutcome(result)).toBe(true);
    }
  });

  it("CORE-2: successful void (outcome succeeded + status cancelled) is not failed", () => {
    const voided = baseResult({
      success: true,
      status: "cancelled",
      outcome: "succeeded",
    });
    expect(inferOperationOutcome(voided)).toBe("succeeded");
    const op = mapGatewayResultToOperationResult(voided);
    expect(op.outcome).toBe("succeeded");
    if (op.outcome === "succeeded") {
      expect(op.payment.status).toBe("cancelled");
    }
    // Not a charge settlement — fulfillment gate stays closed.
    expect(isPaidOutcome(voided)).toBe(false);
    expect(isPaidOutcome(op)).toBe(false);

    // Bare cancelled without force still fails closed.
    expect(
      inferOperationOutcome(
        baseResult({ success: true, status: "cancelled" }),
      ),
    ).toBe("failed");
  });

  it("toPaymentErrorLike fills defaults and optional statusCode", () => {
    expect(toPaymentErrorLike({ message: "x" })).toEqual({
      name: "PaymentError",
      message: "x",
      code: "PAYMENT_ERROR",
    });
    expect(
      toPaymentErrorLike({
        name: "NetworkError",
        message: "down",
        code: "NETWORK_ERROR",
        statusCode: 503,
      }),
    ).toEqual({
      name: "NetworkError",
      message: "down",
      code: "NETWORK_ERROR",
      statusCode: 503,
    });
  });

  it("paymentNextActionToAction maps nextAction and fallback redirect", () => {
    expect(
      paymentNextActionToAction({ type: "redirect", url: "https://a" }),
    ).toEqual({ type: "redirect", url: "https://a" });
    expect(paymentNextActionToAction(undefined, "https://fallback")).toEqual({
      type: "redirect",
      url: "https://fallback",
    });
    expect(paymentNextActionToAction(undefined)).toBeUndefined();
    // Empty type becomes "unknown"
    expect(
      paymentNextActionToAction({ type: "" } as { type: string }),
    ).toEqual({ type: "unknown" });
  });

  it("paymentFromGatewayResult copies optional money and action fields", () => {
    const payment = paymentFromGatewayResult(
      baseResult({
        amount: 12.5,
        currency: "SAR",
        fee: 0.5,
        capturedAmount: 12.5,
        refundedAmount: 1,
        redirectUrl: "https://r",
        clientSecret: "cs_test",
        nextAction: { type: "redirect", url: "https://r" },
      }),
    );
    expect(payment.amount).toBe(12.5);
    expect(payment.currency).toBe("SAR");
    expect(payment.fee).toBe(0.5);
    expect(payment.capturedAmount).toBe(12.5);
    expect(payment.refundedAmount).toBe(1);
    expect(payment.redirectUrl).toBe("https://r");
    expect(payment.clientSecret).toBe("cs_test");
    expect(payment.nextAction?.type).toBe("redirect");
  });

  it("paymentFromGatewayResult fail-closes amount without currency (CORE-1)", () => {
    const incomplete = paymentFromGatewayResult(
      baseResult({
        amount: 12.5,
        fee: 0.5,
        capturedAmount: 12.5,
        refundedAmount: 1,
      }),
    );
    expect(incomplete.amount).toBeUndefined();
    expect(incomplete.currency).toBeUndefined();
    expect(incomplete.fee).toBeUndefined();
    expect(incomplete.capturedAmount).toBeUndefined();
    expect(incomplete.refundedAmount).toBeUndefined();

    const currencyOnly = paymentFromGatewayResult(
      baseResult({ currency: "usd" }),
    );
    expect(currencyOnly.currency).toBe("USD");
    expect(currencyOnly.amount).toBeUndefined();
  });

  it("NEW-MONEY-1: omit non-finite amount-like fields even when currency is set", () => {
    const payment = paymentFromGatewayResult(
      baseResult({
        amount: Number.NaN,
        currency: "usd",
        fee: Number.POSITIVE_INFINITY,
        capturedAmount: 10,
        refundedAmount: Number.NEGATIVE_INFINITY,
      }),
    );
    expect(payment.currency).toBe("USD");
    expect(payment.amount).toBeUndefined();
    expect(payment.fee).toBeUndefined();
    expect(payment.capturedAmount).toBe(10);
    expect(payment.refundedAmount).toBeUndefined();

    const appliedBare = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_bare",
        status: "paid",
        rawResponse: {},
        amount: 25,
        fee: 1,
        capturedAmount: 25,
        refundedAmount: 0,
      },
      "succeeded",
    );
    expect(appliedBare.amount).toBeUndefined();
    expect(appliedBare.currency).toBeUndefined();
    expect(appliedBare.fee).toBeUndefined();
    expect(appliedBare.capturedAmount).toBeUndefined();
    expect(appliedBare.refundedAmount).toBeUndefined();

    const appliedBad = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_nan",
        status: "paid",
        rawResponse: {},
        amount: Number.NaN,
        currency: " sar ",
        fee: Number.POSITIVE_INFINITY,
        capturedAmount: 12,
      },
      "succeeded",
    );
    expect(appliedBad.currency).toBe("SAR");
    expect(appliedBad.amount).toBeUndefined();
    expect(appliedBad.fee).toBeUndefined();
    expect(appliedBad.capturedAmount).toBe(12);
  });

  it("inferOperationOutcome covers failed/declined/processing branches", () => {
    expect(
      inferOperationOutcome(
        baseResult({ success: false, status: "cancelled" }),
      ),
    ).toBe("failed");
    expect(
      inferOperationOutcome(baseResult({ success: false, status: "failed" })),
    ).toBe("failed");
    expect(
      inferOperationOutcome(
        baseResult({ success: false, status: "pending" }),
      ),
    ).toBe("indeterminate");
    expect(
      inferOperationOutcome(
        baseResult({ success: true, status: "processing" }),
      ),
    ).toBe("requires_action");
    expect(
      inferOperationOutcome(
        baseResult({ success: true, status: "partially_refunded" }),
      ),
    ).toBe("succeeded");
  });

  it("mapGatewayResultToOperationResult maps failed and declined arms", () => {
    const failed = mapGatewayResultToOperationResult(
      baseResult({ success: false, status: "cancelled" }),
    );
    expect(failed.outcome).toBe("failed");
    if (failed.outcome === "failed") {
      expect(failed.error.code).toBe("PAYMENT_FAILED");
    }

    const declined = mapGatewayResultToOperationResult(
      baseResult({
        success: false,
        status: "failed",
        decline: { code: "card_declined", message: "nope" },
      }),
    );
    expect(declined.outcome).toBe("declined");
    if (declined.outcome === "declined") {
      expect(declined.failure.code).toBe("card_declined");
    }

    const ind = mapGatewayResultToOperationResult(
      baseResult({
        success: false,
        status: "pending",
        reconciliationRequired: true,
        providerRequestId: "req_x",
      }),
    );
    expect(ind.outcome).toBe("indeterminate");
    if (ind.outcome === "indeterminate") {
      expect(ind.providerRequestId).toBe("req_x");
    }
  });

  it("applyOutcomeToGatewayResult copies optional ids and action extras", () => {
    const full = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_full",
        status: "pending",
        rawResponse: {},
        gateway: "stripe",
        orderId: "ord_1",
        captureId: "cap_1",
        authorizationId: "auth_1",
        amount: 10,
        fee: 1,
        capturedAmount: 10,
        refundedAmount: 0,
        clientSecret: "cs",
        providerRequestId: "req",
      },
      "requires_action",
      {
        action: { type: "use_stripe_sdk", client_secret: "cs" } as never,
        reconciliationRequired: true,
      },
    );
    expect(full.orderId).toBe("ord_1");
    expect(full.captureId).toBe("cap_1");
    expect(full.authorizationId).toBe("auth_1");
    expect(full.clientSecret).toBe("cs");
    expect(full.nextAction).toBeDefined();
    // extras.reconciliationRequired must not attach unless outcome is indeterminate
    // (otherwise stored outcome requires_action but infer would flip).
    expect(full.reconciliationRequired).toBeUndefined();
    expect(full.outcome).toBe("requires_action");
    expect(inferOperationOutcome(full)).toBe(full.outcome);
  });

  it("applyOutcome only attaches reconciliationRequired when outcome is indeterminate", () => {
    const settled = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_paid",
        status: "paid",
        rawResponse: {},
        gateway: "stripe",
      },
      "succeeded",
      { reconciliationRequired: true },
    );
    expect(settled.outcome).toBe("succeeded");
    expect(settled.reconciliationRequired).toBeUndefined();
    expect(inferOperationOutcome(settled)).toBe(settled.outcome);

    const action = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_act",
        status: "pending",
        rawResponse: {},
        gateway: "stripe",
      },
      "requires_action",
      { reconciliationRequired: true },
    );
    expect(action.outcome).toBe("requires_action");
    expect(action.reconciliationRequired).toBeUndefined();
    expect(inferOperationOutcome(action)).toBe(action.outcome);

    const failed = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_fail",
        status: "failed",
        rawResponse: {},
        gateway: "stripe",
      },
      "failed",
      { reconciliationRequired: true },
    );
    expect(failed.outcome).toBe("failed");
    expect(failed.reconciliationRequired).toBeUndefined();
    expect(inferOperationOutcome(failed)).toBe(failed.outcome);

    const ind = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_unk",
        status: "pending",
        rawResponse: {},
        gateway: "paymob",
      },
      "indeterminate",
    );
    expect(ind.outcome).toBe("indeterminate");
    expect(ind.reconciliationRequired).toBe(true);
    expect(inferOperationOutcome(ind)).toBe(ind.outcome);
  });

  it("CORE-5: applyOutcome does not persist succeeded+success with failed/pending status", () => {
    const failed = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_fail_lie",
        status: "failed",
        rawResponse: {},
        gateway: "stripe",
      },
      "succeeded",
    );
    expect(failed.outcome).toBe("failed");
    expect(failed.success).toBe(false);
    expect(failed.status).toBe("failed");
    expect(inferOperationOutcome(failed)).toBe(failed.outcome);

    const declined = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_fail_decline",
        status: "failed",
        rawResponse: {},
        gateway: "stripe",
      },
      "succeeded",
      { decline: { code: "card_declined", message: "nope" } },
    );
    expect(declined.outcome).toBe("declined");
    expect(declined.success).toBe(false);
    expect(inferOperationOutcome(declined)).toBe("declined");

    const pending = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_pend_lie",
        status: "pending",
        rawResponse: {},
        gateway: "stripe",
      },
      "succeeded",
    );
    expect(pending.outcome).toBe("requires_action");
    expect(pending.success).toBe(true);
    expect(pending.status).toBe("pending");
    expect(pending.outcome).not.toBe("succeeded");
    expect(inferOperationOutcome(pending)).toBe(pending.outcome);

    const incompleteRefund = applyOutcomeToGatewayResult(
      {
        gatewayId: "pay_refund_incomplete",
        status: "refund_completed",
        rawResponse: {},
        gateway: "moyasar",
      },
      "succeeded",
    );
    expect(incompleteRefund.outcome).toBe("requires_action");
    expect(incompleteRefund.outcome).not.toBe("succeeded");
    expect(incompleteRefund.status).toBe("refund_completed");
  });

  it("NEW-CORE-6: declined/failed does not persist on paid status", () => {
    const declinedPaid = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_paid_decline",
        status: "paid",
        rawResponse: {},
        gateway: "stripe",
      },
      "declined",
      { decline: { code: "card_declined", message: "nope" } },
    );
    expect(declinedPaid.outcome).toBe("succeeded");
    expect(declinedPaid.success).toBe(true);
    expect(declinedPaid.status).toBe("paid");
    expect(declinedPaid.decline).toBeUndefined();
    expect(isPaidOutcome(declinedPaid)).toBe(true);
    expect(inferOperationOutcome(declinedPaid)).toBe("succeeded");

    const failedPaid = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_paid_fail",
        status: "paid",
        rawResponse: {},
        gateway: "stripe",
      },
      "failed",
    );
    expect(failedPaid.outcome).toBe("succeeded");
    expect(failedPaid.success).toBe(true);
    expect(failedPaid.status).toBe("paid");
    expect(isPaidOutcome(failedPaid)).toBe(true);

    expect(
      inferOperationOutcome(
        baseResult({
          success: false,
          status: "paid",
          outcome: "declined",
        }),
      ),
    ).toBe("succeeded");
  });

  it("NEW-CORE-10: requires_action + status failed is not success:true", () => {
    const applied = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_action_failed",
        status: "failed",
        rawResponse: {},
        gateway: "stripe",
      },
      "requires_action",
    );
    // S20-FAILED-DECLINED: no decline object → failed, not a card decline.
    expect(applied.outcome).toBe("failed");
    expect(applied.success).toBe(false);
    expect(applied.status).toBe("failed");
    expect(inferOperationOutcome(applied)).toBe("failed");
    expect(isPaidOutcome(applied)).toBe(false);
    expect(isRequiresActionOutcome(applied)).toBe(false);

    expect(
      inferOperationOutcome(
        baseResult({
          success: true,
          status: "failed",
          outcome: "requires_action",
        }),
      ),
    ).toBe("failed");

    const mapped = mapGatewayResultToOperationResult(
      baseResult({
        success: true,
        status: "failed",
        outcome: "requires_action",
      }),
    );
    expect(mapped.outcome).toBe("failed");

    const withDecline = applyOutcomeToGatewayResult(
      {
        gatewayId: "pi_action_declined",
        status: "failed",
        rawResponse: {},
        gateway: "stripe",
      },
      "requires_action",
      { decline: { code: "card_declined", message: "nope" } },
    );
    expect(withDecline.outcome).toBe("declined");
    expect(withDecline.success).toBe(false);
    expect(inferOperationOutcome(withDecline)).toBe("declined");
  });

  it("applyOutcomeToGatewayRefundResult dual-writes success from outcome", () => {
    const completed = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_ok",
        status: "completed",
        totalRefunded: 10,
        refundedAt: new Date("2026-01-01T00:00:00Z"),
        rawResponse: { id: "re_ok" },
      },
      "succeeded",
    );
    expect(completed.outcome).toBe("succeeded");
    expect(completed.success).toBe(true);
    expect(completed.success).toBe(successFromRefundOutcome("succeeded"));
    expect(completed.status).toBe("completed");
    expect(completed.totalRefunded).toBe(10);
    expect(completed.refundedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(completed.gatewayRefundId).toBe("re_ok");

    const pending = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_p",
        status: "pending",
        rawResponse: {},
      },
      "pending",
    );
    expect(pending.outcome).toBe("pending");
    expect(pending.success).toBe(true);
    expect(pending.success).toBe(successFromRefundOutcome("pending"));

    const failed = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_f",
        status: "failed",
        rawResponse: {},
      },
      "failed",
    );
    expect(failed.outcome).toBe("failed");
    expect(failed.success).toBe(false);
    expect(failed.success).toBe(successFromRefundOutcome("failed"));
    // Does not invent succeeded from a failed status when outcome is failed
    expect(failed.status).toBe("failed");

    const ind = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_unk",
        status: "pending",
        providerRequestId: "req_r",
        rawResponse: {},
      },
      "indeterminate",
    );
    expect(ind.outcome).toBe("indeterminate");
    expect(ind.success).toBe(false);
    expect(ind.reconciliationRequired).toBe(true);
    expect(ind.providerRequestId).toBe("req_r");
    expect(successFromRefundOutcome("indeterminate")).toBe(false);

    // mapGatewayRefund uses dual-written outcome when present
    const mappedSucceeded = mapGatewayRefundToOperationResult(completed);
    expect(mappedSucceeded.outcome).toBe("succeeded");
    const mappedFailed = mapGatewayRefundToOperationResult(failed);
    expect(mappedFailed.outcome).toBe("failed");
    const mappedInd = mapGatewayRefundToOperationResult(ind);
    expect(mappedInd.outcome).toBe("indeterminate");
    if (mappedInd.outcome === "indeterminate") {
      expect(mappedInd.reconciliationRequired).toBe(true);
    }
  });

  it("NEW-CORE-5: applyOutcomeToGatewayRefundResult coerces outcome vs status", () => {
    const pending = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_pending_lie",
        status: "pending",
        rawResponse: {},
      },
      "succeeded",
    );
    expect(pending.outcome).toBe("pending");
    expect(pending.success).toBe(true);
    expect(pending.success).toBe(successFromRefundOutcome(pending.outcome!));
    expect(pending.status).toBe("pending");
    expect(inferRefundOperationOutcome(pending)).toBe(pending.outcome);

    const failed = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_failed_lie",
        status: "failed",
        rawResponse: {},
      },
      "succeeded",
    );
    expect(failed.outcome).toBe("failed");
    expect(failed.success).toBe(false);
    expect(failed.success).toBe(successFromRefundOutcome(failed.outcome!));
    expect(failed.status).toBe("failed");
    expect(inferRefundOperationOutcome(failed)).toBe(failed.outcome);

    const completed = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_completed_from_pending",
        status: "completed",
        rawResponse: {},
      },
      "pending",
    );
    expect(completed.outcome).toBe("succeeded");
    expect(completed.success).toBe(true);
    expect(completed.status).toBe("completed");
    expect(inferRefundOperationOutcome(completed)).toBe(completed.outcome);

    // NEW-CORE-9: failed + completed → succeeded (status wins; not retryable fail).
    const failedOnCompleted = applyOutcomeToGatewayRefundResult(
      {
        gatewayRefundId: "re_failed_completed",
        status: "completed",
        rawResponse: {},
      },
      "failed",
    );
    expect(failedOnCompleted.outcome).toBe("succeeded");
    expect(failedOnCompleted.success).toBe(true);
    expect(failedOnCompleted.status).toBe("completed");
    expect(inferRefundOperationOutcome(failedOnCompleted)).toBe("succeeded");
    expect(
      inferRefundOperationOutcome({
        success: false,
        status: "completed",
        gatewayRefundId: "re_failed_outcome_completed",
        rawResponse: {},
        outcome: "failed",
      }),
    ).toBe("succeeded");
  });

  it("inferRefundOperationOutcome + map cover indeterminate and failed", () => {
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "completed",
        gatewayRefundId: "re_1",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
      }),
    ).toBe("succeeded");
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "pending",
        gatewayRefundId: "re_2",
        amount: 1,
        currency: "SAR",
        rawResponse: { indeterminate: true },
      }),
    ).toBe("indeterminate");
    expect(
      inferRefundOperationOutcome({
        success: false,
        status: "failed",
        gatewayRefundId: "re_3",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
      }),
    ).toBe("failed");
    // CORE-1: explicit pending + completed status coerces to succeeded (status wins)
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "completed",
        gatewayRefundId: "re_4",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
        outcome: "pending",
      }),
    ).toBe("succeeded");

    // CORE-1: reconciliationRequired beats explicit outcome succeeded
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "completed",
        gatewayRefundId: "re_recon",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
        outcome: "succeeded",
        reconciliationRequired: true,
      }),
    ).toBe("indeterminate");

    // CORE-1: bare infer must not report succeeded while status pending
    expect(
      inferRefundOperationOutcome({
        success: true,
        status: "pending",
        gatewayRefundId: "re_pending_coerce",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
        outcome: "succeeded",
      }),
    ).toBe("pending");

    // CORE-1: bare infer coerces succeeded + failed status → failed
    expect(
      inferRefundOperationOutcome({
        success: false,
        status: "failed",
        gatewayRefundId: "re_failed_coerce",
        amount: 1,
        currency: "SAR",
        rawResponse: {},
        outcome: "succeeded",
      }),
    ).toBe("failed");

    // P610-INF-2 / CORE-1: success:false + pending is indeterminate, not failed
    expect(
      inferRefundOperationOutcome({
        success: false,
        status: "pending",
        gatewayRefundId: "re_pending_false",
        rawResponse: {},
      }),
    ).toBe("indeterminate");
    const mappedPendingFalse = mapGatewayRefundToOperationResult({
      success: false,
      status: "pending",
      gatewayRefundId: "re_pending_false_map",
      rawResponse: {},
    });
    expect(mappedPendingFalse.outcome).toBe("indeterminate");
    if (mappedPendingFalse.outcome === "indeterminate") {
      expect(mappedPendingFalse.reconciliationRequired).toBe(true);
    }

    // P610-INF-2: omitted success + pending is also indeterminate
    expect(
      inferRefundOperationOutcome({
        status: "pending",
        gatewayRefundId: "re_omit_success",
        rawResponse: {},
      } as Parameters<typeof inferRefundOperationOutcome>[0]),
    ).toBe("indeterminate");

    // CORE-INF-2: success:false + completed is uncertain (not a retryable fail)
    expect(
      inferRefundOperationOutcome({
        success: false,
        status: "completed",
        gatewayRefundId: "re_completed_false",
        rawResponse: {},
      }),
    ).toBe("indeterminate");
    const mappedCompletedFalse = mapGatewayRefundToOperationResult({
      success: false,
      status: "completed",
      gatewayRefundId: "re_completed_false_map",
      rawResponse: {},
    });
    expect(mappedCompletedFalse.outcome).toBe("indeterminate");
    if (mappedCompletedFalse.outcome === "indeterminate") {
      expect(mappedCompletedFalse.reconciliationRequired).toBe(true);
    }
    expect(
      inferRefundOperationOutcome({
        status: "completed",
        gatewayRefundId: "re_omit_completed",
        rawResponse: {},
      } as Parameters<typeof inferRefundOperationOutcome>[0]),
    ).toBe("indeterminate");

    const mapped = mapGatewayRefundToOperationResult({
      success: false,
      status: "failed",
      gatewayRefundId: "re_f",
      amount: 2,
      currency: "USD",
      rawResponse: {},
    });
    expect(mapped.outcome).toBe("failed");

    // CORE-2: gateway pending beats invented completed on succeeded outcome
    const mappedPending = mapGatewayRefundToOperationResult({
      success: true,
      status: "pending",
      gatewayRefundId: "re_p",
      amount: 1,
      currency: "SAR",
      rawResponse: {},
      outcome: "succeeded",
    });
    expect(mappedPending.outcome).toBe("pending");
    if (mappedPending.outcome === "pending") {
      expect(mappedPending.status).toBe("pending");
    }
  });

  it("isGatewayPaymentResult narrows plain objects", () => {
    expect(isGatewayPaymentResult(baseResult())).toBe(true);
    expect(isGatewayPaymentResult(null)).toBe(false);
    expect(isGatewayPaymentResult({})).toBe(false);
  });
});
