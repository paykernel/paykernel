import { describe, it, expect } from "bun:test";
import {
  classifyFromOperationOutcome,
  classifySubmissionState,
  evaluateFallback,
  isExpertUnsafeFallbackOverride,
  isSafeFallbackEligible,
  trySelectFallbackGateway,
} from "./fallback";
import { createPaymentRouter } from "./router";
import { route } from "./route";
import { UnsafeFallbackDeniedError } from "./errors";
import type { SubmissionState } from "./types";

const UNSAFE: SubmissionState[] = [
  "timeout",
  "connection_reset",
  "indeterminate",
  "provider_5xx_uncertain",
  "submitted",
];

const SAFE: SubmissionState[] = ["not_submitted", "pre_submission_failure"];

describe("isSafeFallbackEligible (A2)", () => {
  for (const state of UNSAFE) {
    it(`false for ${state}`, () => {
      expect(isSafeFallbackEligible(state)).toBe(false);
    });
  }

  for (const state of SAFE) {
    it(`true for ${state}`, () => {
      expect(isSafeFallbackEligible(state)).toBe(true);
    });
  }
});

describe("evaluateFallback", () => {
  it("allows safe states without override", () => {
    for (const state of SAFE) {
      const e = evaluateFallback({ submissionState: state });
      expect(e.allowed).toBe(true);
      expect(e.submissionState).toBe(state);
      expect(e.expertOverride).toBeUndefined();
    }
  });

  it("denies unsafe states without expert override", () => {
    for (const state of UNSAFE) {
      const e = evaluateFallback({ submissionState: state });
      expect(e.allowed).toBe(false);
      expect(e.submissionState).toBe(state);
      expect(e.reason).toMatch(/^denied_/);
    }
  });

  it("allows unsafe with confirmUnsafeFallback + non-empty reason", () => {
    const e = evaluateFallback({
      submissionState: "timeout",
      expertOverride: {
        confirmUnsafeFallback: true,
        reason: "manual ops recovery after provider confirm no charge",
      },
    });
    expect(e.allowed).toBe(true);
    expect(e.expertOverride).toBe(true);
    expect(e.reason).toContain("expert_override:");
  });

  it("denies expert override with empty reason", () => {
    const e = evaluateFallback({
      submissionState: "indeterminate",
      expertOverride: {
        confirmUnsafeFallback: true,
        reason: "   ",
      },
    });
    expect(e.allowed).toBe(false);
  });

  it("does not accept bare boolean as override", () => {
    // Type system prevents this; runtime shape check via isExpertUnsafeFallbackOverride
    expect(isExpertUnsafeFallbackOverride(true)).toBe(false);
    expect(isExpertUnsafeFallbackOverride({ confirmUnsafeFallback: true })).toBe(
      false,
    );
    expect(
      isExpertUnsafeFallbackOverride({
        confirmUnsafeFallback: true,
        reason: "ok",
      }),
    ).toBe(true);
  });
});

describe("classifyFromOperationOutcome / classifySubmissionState", () => {
  it("never maps indeterminate → pre_submission_failure", () => {
    expect(classifyFromOperationOutcome("indeterminate")).toBe(
      "indeterminate",
    );
    expect(
      classifySubmissionState({ outcome: "indeterminate" }),
    ).toBe("indeterminate");
    expect(
      classifySubmissionState({
        result: { outcome: "indeterminate", reconciliationRequired: true },
      }),
    ).toBe("indeterminate");
  });

  it("maps succeeded/declined/requires_action to submitted", () => {
    expect(classifyFromOperationOutcome("succeeded")).toBe("submitted");
    expect(classifyFromOperationOutcome("declined")).toBe("submitted");
    expect(classifyFromOperationOutcome("requires_action")).toBe("submitted");
  });

  it("maps timeout / connection_reset error kinds", () => {
    expect(classifySubmissionState({ errorKind: "timeout" })).toBe("timeout");
    expect(classifySubmissionState({ errorKind: "ECONNRESET" })).toBe(
      "connection_reset",
    );
    expect(classifySubmissionState({ errorKind: "not_submitted" })).toBe(
      "not_submitted",
    );
    expect(classifySubmissionState({ errorKind: "validation_error" })).toBe(
      "indeterminate",
    );
    // ROUTE-1: bare invalid_request is indeterminate (may be post-accept).
    expect(classifySubmissionState({ errorKind: "invalid_request" })).toBe(
      "indeterminate",
    );
    expect(
      classifySubmissionState({ errorKind: "provider_5xx_uncertain" }),
    ).toBe("provider_5xx_uncertain");
  });

  it("ROUTE-2: validation_error does not override indeterminate/succeeded outcomes", () => {
    expect(
      classifySubmissionState({
        errorKind: "validation_error",
        outcome: "indeterminate",
      }),
    ).toBe("indeterminate");
    expect(
      classifySubmissionState({
        errorKind: "validation_error",
        outcome: "succeeded",
      }),
    ).toBe("submitted");
    expect(
      evaluateFallback({
        submissionState: classifySubmissionState({
          errorKind: "validation_error",
          outcome: "indeterminate",
        }),
      }).allowed,
    ).toBe(false);
    // Bare errorKind validation_error (no ValidationError-shaped object) is
    // indeterminate — same class as invalid_request. Apps must not map
    // provider 400s onto this kind.
    expect(classifySubmissionState({ errorKind: "validation_error" })).toBe(
      "indeterminate",
    );
  });

  it("P21-VALIDATION-ERROR: ValidationError-shaped object remains pre_submission_failure", () => {
    expect(
      classifySubmissionState({
        error: { name: "ValidationError", message: "schema" },
      }),
    ).toBe("pre_submission_failure");
    expect(
      classifySubmissionState({
        error: { name: "Error", code: "validation_error" },
      }),
    ).toBe("pre_submission_failure");
    expect(
      evaluateFallback({
        submissionState: classifySubmissionState({
          error: { name: "ValidationError" },
        }),
      }).allowed,
    ).toBe(true);
    expect(
      evaluateFallback({
        submissionState: classifySubmissionState({
          errorKind: "validation_error",
        }),
      }).allowed,
    ).toBe(false);
  });

  it("P21-EXPLICIT-STATE: explicit safe state does not override money-moving / uncertain evidence", () => {
    expect(
      classifySubmissionState({
        submissionState: "not_submitted",
        outcome: "indeterminate",
        errorKind: "timeout",
      }),
    ).toBe("timeout");
    expect(
      classifySubmissionState({
        submissionState: "not_submitted",
        outcome: "indeterminate",
      }),
    ).toBe("indeterminate");
    expect(
      classifySubmissionState({
        submissionState: "pre_submission_failure",
        outcome: "succeeded",
      }),
    ).toBe("submitted");
    expect(
      classifySubmissionState({
        submissionState: "not_submitted",
        errorKind: "connection_reset",
      }),
    ).toBe("connection_reset");
    expect(
      classifySubmissionState({
        submissionState: "not_submitted",
        errorKind: "provider_5xx_uncertain",
      }),
    ).toBe("provider_5xx_uncertain");
    expect(
      classifySubmissionState({
        submissionState: "pre_submission_failure",
        errorKind: "submitted",
      }),
    ).toBe("submitted");
    expect(
      evaluateFallback({
        submissionState: classifySubmissionState({
          submissionState: "not_submitted",
          outcome: "indeterminate",
          errorKind: "timeout",
        }),
      }).allowed,
    ).toBe(false);
  });

  it("P21-EXPLICIT-STATE: explicit state still wins without conflicting money evidence", () => {
    expect(
      classifySubmissionState({
        submissionState: "not_submitted",
      }),
    ).toBe("not_submitted");
    expect(
      classifySubmissionState({
        submissionState: "pre_submission_failure",
        errorKind: "configuration_error",
      }),
    ).toBe("pre_submission_failure");
    expect(
      classifySubmissionState({
        submissionState: "timeout",
      }),
    ).toBe("timeout");
  });

  it("unknown defaults to indeterminate (fail-closed)", () => {
    expect(classifySubmissionState({})).toBe("indeterminate");
  });

  it("maps AbortError shape to indeterminate (not fallback-eligible by default)", () => {
    // Abort may race after provider accept — never default-allow multi-gateway.
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(classifySubmissionState({ error: err })).toBe("indeterminate");
    expect(
      evaluateFallback({
        submissionState: classifySubmissionState({ error: err }),
      }).allowed,
    ).toBe(false);
    expect(
      isSafeFallbackEligible(classifySubmissionState({ error: err })),
    ).toBe(false);
  });

  it("maps abort_error / ABORT_ERR codes and errorKinds to indeterminate", () => {
    expect(
      classifySubmissionState({ error: { name: "Error", code: "abort_error" } }),
    ).toBe("indeterminate");
    expect(
      classifySubmissionState({ error: { name: "Error", code: "ABORT_ERR" } }),
    ).toBe("indeterminate");
    expect(classifySubmissionState({ errorKind: "abort_error" })).toBe(
      "indeterminate",
    );
    expect(classifySubmissionState({ errorKind: "aborted" })).toBe(
      "indeterminate",
    );
    expect(
      evaluateFallback({
        submissionState: classifySubmissionState({ errorKind: "abort_error" }),
      }).allowed,
    ).toBe(false);
  });

  it("explicit pre-submit abort kinds remain not_submitted (safe)", () => {
    expect(
      classifySubmissionState({ errorKind: "aborted_before_submit" }),
    ).toBe("not_submitted");
    expect(
      classifySubmissionState({ errorKind: "cancelled_before_submit" }),
    ).toBe("not_submitted");
    expect(
      evaluateFallback({
        submissionState: classifySubmissionState({
          errorKind: "aborted_before_submit",
        }),
      }).allowed,
    ).toBe(true);
  });

  it("expertUnsafeAbortAsNotSubmitted restores old AbortError → not_submitted", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(
      classifySubmissionState({
        error: err,
        expertUnsafeAbortAsNotSubmitted: true,
      }),
    ).toBe("not_submitted");
    expect(
      classifySubmissionState({
        errorKind: "abort_error",
        expertUnsafeAbortAsNotSubmitted: true,
      }),
    ).toBe("not_submitted");
    expect(
      evaluateFallback({
        submissionState: classifySubmissionState({
          error: err,
          expertUnsafeAbortAsNotSubmitted: true,
        }),
      }).allowed,
    ).toBe(true);
  });
});

describe("trySelectFallbackGateway", () => {
  const router = createPaymentRouter({
    rules: [
      route({ currency: "USD" }).to("stripe"),
      route({ currency: "USD" }).to("paypal"),
    ],
    fallback: "stripe",
  });

  it("throws when eligibility denied", () => {
    const eligibility = evaluateFallback({ submissionState: "timeout" });
    expect(() =>
      trySelectFallbackGateway(
        router,
        { currency: "USD" },
        eligibility,
        { attemptedGateways: ["stripe"] },
      ),
    ).toThrow(UnsafeFallbackDeniedError);
  });

  it("denies alternate select when AbortError classified (default)", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    const state = classifySubmissionState({ error: err });
    const eligibility = evaluateFallback({ submissionState: state });
    expect(eligibility.allowed).toBe(false);
    expect(() =>
      trySelectFallbackGateway(
        router,
        { currency: "USD" },
        eligibility,
        { attemptedGateways: ["stripe"] },
      ),
    ).toThrow(UnsafeFallbackDeniedError);
  });

  it("selects alternate when safe and excludes attempted", () => {
    const eligibility = evaluateFallback({
      submissionState: "not_submitted",
    });
    const decision = trySelectFallbackGateway(
      router,
      { currency: "USD" },
      eligibility,
      { attemptedGateways: ["stripe"] },
    );
    expect(decision.gateway).toBe("paypal");
    expect(decision.gateway).not.toBe("stripe");
  });

  it("ROUTE-1: attemptedGateways exclusion is case-insensitive", () => {
    const eligibility = evaluateFallback({
      submissionState: "not_submitted",
    });
    const decision = trySelectFallbackGateway(
      router,
      { currency: "USD" },
      eligibility,
      { attemptedGateways: ["Stripe", "STRIPE"] },
    );
    expect(decision.gateway).toBe("paypal");
  });

  it("throws no_alternate_gateway when every candidate was already attempted", () => {
    const eligibility = evaluateFallback({
      submissionState: "pre_submission_failure",
    });
    expect(() =>
      trySelectFallbackGateway(
        router,
        { currency: "USD" },
        eligibility,
        { attemptedGateways: ["stripe", "paypal"] },
      ),
    ).toThrow(UnsafeFallbackDeniedError);
  });

  it("forged eligibility.allowed is rejected without expertOverride", () => {
    for (const submissionState of UNSAFE) {
      const forged = {
        allowed: true,
        reason: "forged",
        submissionState,
      };
      expect(() =>
        trySelectFallbackGateway(
          router,
          { currency: "USD" },
          forged,
          { attemptedGateways: ["stripe"] },
        ),
      ).toThrow(UnsafeFallbackDeniedError);
    }
  });

  it("ROUTE-2: forged expertOverride:true without expert_override reason is rejected", () => {
    for (const submissionState of UNSAFE) {
      const forged = {
        allowed: true,
        reason: "forged",
        submissionState,
        expertOverride: true as const,
      };
      expect(() =>
        trySelectFallbackGateway(
          router,
          { currency: "USD" },
          forged,
          { attemptedGateways: ["stripe"] },
        ),
      ).toThrow(UnsafeFallbackDeniedError);
    }
    // Empty suffix after prefix also rejected
    expect(() =>
      trySelectFallbackGateway(
        router,
        { currency: "USD" },
        {
          allowed: true,
          reason: "expert_override:",
          submissionState: "timeout",
          expertOverride: true,
        },
        { attemptedGateways: ["stripe"] },
      ),
    ).toThrow(UnsafeFallbackDeniedError);
  });

  it("ROUTE-3: forged expert_override reason prefix is rejected", () => {
    // Forged object with the evaluateFallback reason shape must not pass —
    // only authentic evaluateFallback results (WeakSet brand) are accepted.
    for (const submissionState of UNSAFE) {
      const forged = {
        allowed: true,
        reason: "expert_override:forged_by_attacker",
        submissionState,
        expertOverride: true as const,
      };
      expect(() =>
        trySelectFallbackGateway(
          router,
          { currency: "USD" },
          forged,
          { attemptedGateways: ["stripe"] },
        ),
      ).toThrow(UnsafeFallbackDeniedError);
    }
  });

  it("P21-EXCLUDE-HONESTY: attemptedGateways cannot send out-of-range amount to unconstrained fallback", () => {
    const ranged = createPaymentRouter({
      rules: [
        route({
          amountMin: "100.00",
          amountCurrency: "USD",
        }).to("enterprise-psp"),
      ],
      fallback: "stripe",
    });
    const eligibility = evaluateFallback({
      submissionState: "not_submitted",
    });
    expect(() =>
      trySelectFallbackGateway(
        ranged,
        { amount: { amount: "50.00", currency: "USD" } },
        eligibility,
        { attemptedGateways: ["enterprise-psp"] },
      ),
    ).toThrow(UnsafeFallbackDeniedError);
    expect(() =>
      trySelectFallbackGateway(
        ranged,
        {
          amount: { amount: "50.00", currency: "USD" },
          excludeGateways: ["enterprise-psp"],
        },
        eligibility,
      ),
    ).toThrow(UnsafeFallbackDeniedError);
    expect(() =>
      trySelectFallbackGateway(
        ranged,
        {
          amount: { amount: "50.00", currency: "USD" },
          health: { "enterprise-psp": false },
        },
        eligibility,
      ),
    ).toThrow(UnsafeFallbackDeniedError);
  });

  it("P21-EXCLUDE-HONESTY: attemptedGateways cannot drop rule-level requiredCapabilities", () => {
    const capped = createPaymentRouter({
      rules: [
        route({
          currency: "USD",
          requiredCapabilities: ["refunds"],
        }).to("stripe"),
      ],
      fallback: "paypal",
    });
    const eligibility = evaluateFallback({
      submissionState: "not_submitted",
    });
    const input = {
      currency: "USD",
      gatewayCapabilities: {
        stripe: { refunds: true },
        paypal: { payments: true },
      },
    };
    expect(() =>
      trySelectFallbackGateway(capped, input, eligibility, {
        attemptedGateways: ["stripe"],
      }),
    ).toThrow(UnsafeFallbackDeniedError);
    expect(() =>
      trySelectFallbackGateway(
        capped,
        { ...input, excludeGateways: ["stripe"] },
        eligibility,
      ),
    ).toThrow(UnsafeFallbackDeniedError);
    expect(() =>
      trySelectFallbackGateway(
        capped,
        { ...input, health: { stripe: false } },
        eligibility,
      ),
    ).toThrow(UnsafeFallbackDeniedError);
  });

  it("genuine evaluateFallback expertOverride still allows unsafe select", () => {
    const eligibility = evaluateFallback({
      submissionState: "timeout",
      expertOverride: {
        confirmUnsafeFallback: true,
        reason: "ops confirmed no charge at primary",
      },
    });
    expect(eligibility.allowed).toBe(true);
    expect(eligibility.expertOverride).toBe(true);
    expect(eligibility.reason.startsWith("expert_override:")).toBe(true);
    const decision = trySelectFallbackGateway(
      router,
      { currency: "USD" },
      eligibility,
      { attemptedGateways: ["stripe"] },
    );
    expect(decision.gateway).toBe("paypal");
  });
});
