import { describe, expect, it } from "bun:test";
import { defineGatewayCapabilities } from "@paykernel/core";
import {
  GATEWAY_CONFORMANCE_CASES,
  mockGateway,
  runGatewayConformanceSuite,
} from "../index";

const fullCaps = defineGatewayCapabilities({
  payments: true,
  immediateCapture: true,
  authorization: true,
  partialCapture: true,
  refunds: true,
  partialRefunds: true,
  voids: true,
});

describe("runGatewayConformanceSuite", () => {
  it("golden-path mockGateway passes full suite (all cases)", async () => {
    const report = await runGatewayConformanceSuite({
      name: "mock-golden",
      mode: "full",
      createGateway: () =>
        mockGateway({
          name: "mock-golden",
          capabilities: fullCaps,
        }),
      capabilities: fullCaps,
    });
    expect(report.ok).toBe(true);
    expect(report.failed).toEqual([]);
    expect(report.passed.length).toBeGreaterThan(0);
    // Every named case should appear as passed or skipped (not missing)
    const seen = new Set([
      ...report.passed,
      ...report.failed.map((f) => f.case),
      ...report.skipped.map((s) => s.case),
    ]);
    for (const c of GATEWAY_CONFORMANCE_CASES) {
      expect(seen.has(c)).toBe(true);
    }
    // Full mock path: no skips expected for full capabilities
    expect(report.skipped).toEqual([]);
  });

  it("skips partial_capture when capability unclaimed", async () => {
    const caps = defineGatewayCapabilities({
      payments: true,
      immediateCapture: true,
      refunds: true,
    });
    const report = await runGatewayConformanceSuite({
      name: "limited",
      mode: "full",
      createGateway: () =>
        mockGateway({
          name: "limited",
          capabilities: caps,
        }),
      capabilities: caps,
    });
    expect(report.ok).toBe(true);
    const partial = report.skipped.find((s) => s.case === "partial_capture");
    expect(partial).toBeDefined();
    expect(partial?.reason).toMatch(/partialCapture/);
  });

  it("structural mode only runs capabilities_parity + claim_method_presence", async () => {
    const report = await runGatewayConformanceSuite({
      name: "structural-mock",
      mode: "structural",
      createGateway: () => mockGateway({ capabilities: fullCaps }),
      capabilities: fullCaps,
    });
    expect(report.ok).toBe(true);
    expect(report.passed).toContain("capabilities_parity");
    expect(report.passed).toContain("claim_method_presence");
    expect(report.passed.length).toBe(2);
    expect(report.skipped.length).toBeGreaterThan(0);
  });

  it("include/exclude filters named cases", async () => {
    const report = await runGatewayConformanceSuite({
      name: "filtered",
      mode: "full",
      include: ["capabilities_parity", "amount_conversion"],
      exclude: ["amount_conversion"],
      createGateway: () => mockGateway({ capabilities: fullCaps }),
      capabilities: fullCaps,
    });
    expect(report.ok).toBe(true);
    expect(report.passed).toEqual(["capabilities_parity"]);
    expect(report.skipped.some((s) => s.case === "amount_conversion")).toBe(
      true,
    );
  });

  it("report shape: passed string[], failed/skipped objects", async () => {
    const report = await runGatewayConformanceSuite({
      name: "shape",
      mode: "structural",
      createGateway: () => mockGateway({ capabilities: fullCaps }),
      capabilities: fullCaps,
    });
    expect(typeof report.name).toBe("string");
    expect(typeof report.ok).toBe("boolean");
    expect(Array.isArray(report.passed)).toBe(true);
    expect(Array.isArray(report.failed)).toBe(true);
    expect(Array.isArray(report.skipped)).toBe(true);
  });

  it("partial_capture and partial_refund cases pass with strict money asserts (TESTKIT-1)", async () => {
    const report = await runGatewayConformanceSuite({
      name: "partial-money",
      mode: "full",
      include: ["partial_capture", "partial_refund", "safe_retry"],
      createGateway: () =>
        mockGateway({
          name: "partial-money",
          capabilities: fullCaps,
        }),
      capabilities: fullCaps,
    });
    expect(report.ok).toBe(true);
    expect(report.failed).toEqual([]);
    expect(report.passed).toContain("partial_capture");
    expect(report.passed).toContain("partial_refund");
    expect(report.passed).toContain("safe_retry");
  });

  it("safe_retry fails when gatewayId diverges on retry (TESTKIT-2)", async () => {
    const report = await runGatewayConformanceSuite({
      name: "unsafe-retry",
      mode: "full",
      include: ["safe_retry"],
      createGateway: () =>
        mockGateway({
          name: "split",
          capabilities: fullCaps,
          // Disable process-local idempotency so retries mint new gatewayIds
          honorIdempotencyKey: false,
        }),
      capabilities: fullCaps,
    });
    expect(report.ok).toBe(false);
    const fail = report.failed.find((f) => f.case === "safe_retry");
    expect(fail).toBeDefined();
    expect(fail?.error).toMatch(/same gatewayId/i);
  });
});
