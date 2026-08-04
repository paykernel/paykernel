/**
 * Offline-only built-in gateway conformance.
 *
 * Built-in gateways use global fetch and must NEVER hit live APIs here.
 * applicable / structural suite modes skip provider HTTP; only capabilities,
 * claim/method presence, and offline webhook rejection paths run.
 */

import { describe, expect, it } from "bun:test";
import {
  BUILTIN_GATEWAY_CAPABILITIES,
  defineGatewayCapabilities,
} from "@paykernel/core";
import { mockGateway, runGatewayConformanceSuite } from "../index";
import {
  BUILTIN_GATEWAY_NAMES,
  runBuiltinGatewayConformance,
} from "./run-builtin-applicable";

describe("built-in applicable/structural conformance", () => {
  for (const name of BUILTIN_GATEWAY_NAMES) {
    it(`${name} applicable suite ok (skips allowed)`, async () => {
      const report = await runBuiltinGatewayConformance(name, {
        mode: "applicable",
      });
      expect(report.ok).toBe(true);
      expect(report.failed).toEqual([]);
      expect(report.passed).toContain("capabilities_parity");
      expect(report.passed).toContain("claim_method_presence");
      // Network createPayment paths must be skipped, not executed live
      const amount = report.skipped.find((s) => s.case === "amount_conversion");
      expect(amount).toBeDefined();
      expect(amount?.reason).toMatch(/applicable|offline|HTTP|mock/i);
    });

    it(`${name} structural suite ok`, async () => {
      const report = await runBuiltinGatewayConformance(name, {
        mode: "structural",
      });
      expect(report.ok).toBe(true);
      expect(report.failed).toEqual([]);
      expect(report.passed).toEqual([
        "capabilities_parity",
        "claim_method_presence",
      ]);
    });

    it(`${name} capabilities match BUILTIN_GATEWAY_CAPABILITIES`, async () => {
      const report = await runBuiltinGatewayConformance(name, {
        mode: "structural",
        capabilities: BUILTIN_GATEWAY_CAPABILITIES[name],
      });
      expect(report.ok).toBe(true);
    });
  }
});

describe("mock harness stands in for offline full suite", () => {
  it("mock configured like stripe caps passes full suite", async () => {
    const caps = BUILTIN_GATEWAY_CAPABILITIES.stripe;
    const report = await runGatewayConformanceSuite({
      name: "stripe-shaped-mock",
      mode: "full",
      createGateway: () =>
        mockGateway({
          name: "stripe-shaped-mock",
          capabilities: caps,
        }),
      capabilities: caps,
    });
    expect(report.ok).toBe(true);
    expect(report.failed).toEqual([]);
  });

  it("unclaimed capabilities are skipped", async () => {
    const caps = defineGatewayCapabilities({ payments: true });
    const report = await runGatewayConformanceSuite({
      name: "minimal",
      mode: "full",
      createGateway: () => mockGateway({ capabilities: caps }),
      capabilities: caps,
    });
    expect(report.ok).toBe(true);
    expect(report.skipped.length).toBeGreaterThan(0);
  });
});
