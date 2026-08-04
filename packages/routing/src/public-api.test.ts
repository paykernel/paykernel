/**
 * Public API surface — freezes runtime export names for @paykernel/routing.
 */
import { describe, it, expect } from "bun:test";
import * as routing from "./index";

describe("public API runtime surface", () => {
  it("re-exports every documented runtime symbol from the package root", () => {
    const runtimeExports: Array<[string, unknown]> = [
      ["createPaymentRouter", routing.createPaymentRouter],
      ["route", routing.route],
      ["decisionToTelemetryAttributes", routing.decisionToTelemetryAttributes],
      ["isSafeFallbackEligible", routing.isSafeFallbackEligible],
      ["evaluateFallback", routing.evaluateFallback],
      ["classifySubmissionState", routing.classifySubmissionState],
      ["classifyFromOperationOutcome", routing.classifyFromOperationOutcome],
      ["trySelectFallbackGateway", routing.trySelectFallbackGateway],
      ["isExpertUnsafeFallbackOverride", routing.isExpertUnsafeFallbackOverride],
      ["ruleMatches", routing.ruleMatches],
      ["gatewayHasCapabilities", routing.gatewayHasCapabilities],
      ["isGatewayHealthy", routing.isGatewayHealthy],
      ["costScore", routing.costScore],
      ["stringsEqualCi", routing.stringsEqualCi],
      ["amountInRange", routing.amountInRange],
      ["resolveInputAmount", routing.resolveInputAmount],
      ["compareDecimalAmounts", routing.compareDecimalAmounts],
      ["NoRouteMatchError", routing.NoRouteMatchError],
      ["UnsafeFallbackDeniedError", routing.UnsafeFallbackDeniedError],
      ["isNoRouteMatchError", routing.isNoRouteMatchError],
      ["isUnsafeFallbackDeniedError", routing.isUnsafeFallbackDeniedError],
    ];

    for (const [name, value] of runtimeExports) {
      expect(value, `missing export: ${name}`).toBeDefined();
    }

    expect(typeof routing.createPaymentRouter).toBe("function");
    expect(typeof routing.route).toBe("function");
    expect(typeof routing.isSafeFallbackEligible).toBe("function");
    expect(typeof routing.evaluateFallback).toBe("function");
    expect(typeof routing.decisionToTelemetryAttributes).toBe("function");
  });

  it("NoRouteMatchError is constructible with code no_route_match", () => {
    const err = new routing.NoRouteMatchError("test", { currency: "USD" });
    expect(err.code).toBe("no_route_match");
    expect(routing.isNoRouteMatchError(err)).toBe(true);
  });

  it("UnsafeFallbackDeniedError is constructible", () => {
    const err = new routing.UnsafeFallbackDeniedError("denied", {
      submissionState: "timeout",
      reason: "denied_timeout",
    });
    expect(err.code).toBe("unsafe_fallback_denied");
    expect(err.submissionState).toBe("timeout");
    expect(routing.isUnsafeFallbackDeniedError(err)).toBe(true);
  });
});
