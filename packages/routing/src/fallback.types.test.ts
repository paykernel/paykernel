/**
 * Phase 21 — type-level safety for post-attempt fallback (A2).
 *
 * Unsafe auto-fallback must not be representable as a defaulted boolean.
 * Expert override requires branded `{ confirmUnsafeFallback: true; reason: string }`.
 *
 * Enforced by `tsc -p tsconfig.type-tests.json`. Bun runs a trivial runtime smoke.
 */
import { describe, it, expect } from "bun:test";
import { evaluateFallback, isSafeFallbackEligible } from "./fallback";
import type {
  ExpertUnsafeFallbackOverride,
  FallbackEligibility,
  SubmissionState,
} from "./types";

// ---------------------------------------------------------------------------
// Positive assignability
// ---------------------------------------------------------------------------

const safeStates: SubmissionState[] = [
  "not_submitted",
  "pre_submission_failure",
];

const unsafeStates: SubmissionState[] = [
  "submitted",
  "indeterminate",
  "timeout",
  "connection_reset",
  "provider_5xx_uncertain",
];

const validOverride: ExpertUnsafeFallbackOverride = {
  confirmUnsafeFallback: true,
  reason: "ops confirmed no charge",
};

const _eligibilitySafe: FallbackEligibility = evaluateFallback({
  submissionState: "not_submitted",
});

const _eligibilityOverride: FallbackEligibility = evaluateFallback({
  submissionState: "timeout",
  expertOverride: validOverride,
});

// ---------------------------------------------------------------------------
// Negative: bare true / incomplete override is not ExpertUnsafeFallbackOverride
// ---------------------------------------------------------------------------

// @ts-expect-error — bare boolean is not ExpertUnsafeFallbackOverride
const _badOverride1: ExpertUnsafeFallbackOverride = true;

// @ts-expect-error — missing required reason
const _badOverride2: ExpertUnsafeFallbackOverride = {
  confirmUnsafeFallback: true,
};

const _badOverride3: ExpertUnsafeFallbackOverride = {
  // @ts-expect-error — confirmUnsafeFallback must be literal true, not false
  confirmUnsafeFallback: false,
  reason: "nope",
};

evaluateFallback({
  submissionState: "timeout",
  // @ts-expect-error — evaluateFallback does not accept expertOverride: true
  expertOverride: true,
});

evaluateFallback({
  submissionState: "timeout",
  // @ts-expect-error — evaluateFallback does not accept incomplete override
  expertOverride: { confirmUnsafeFallback: true },
});

// ---------------------------------------------------------------------------
// Runtime smoke (types above are compile-only)
// ---------------------------------------------------------------------------

describe("fallback type-level smoke", () => {
  it("safe states remain eligible at runtime", () => {
    for (const s of safeStates) {
      expect(isSafeFallbackEligible(s)).toBe(true);
    }
    for (const s of unsafeStates) {
      expect(isSafeFallbackEligible(s)).toBe(false);
    }
    expect(_eligibilitySafe.allowed).toBe(true);
    expect(_eligibilityOverride.allowed).toBe(true);
    // Keep negative bindings referenced so they are not DCE'd as unused
    void _badOverride1;
    void _badOverride2;
    void _badOverride3;
  });
});
