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
      "pre_submission_failure",
    );
    expect(
      classifySubmissionState({ errorKind: "provider_5xx_uncertain" }),
    ).toBe("provider_5xx_uncertain");
  });

  it("explicit submissionState wins", () => {
    expect(
      classifySubmissionState({
        submissionState: "not_submitted",
        outcome: "indeterminate",
        errorKind: "timeout",
      }),
    ).toBe("not_submitted");
  });

  it("unknown defaults to indeterminate (fail-closed)", () => {
    expect(classifySubmissionState({})).toBe("indeterminate");
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
});
