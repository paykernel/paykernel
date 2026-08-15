/**
 * Public API surface — freezes runtime export names for @paykernel/reconciliation.
 */
import { describe, it, expect } from "bun:test";
import * as recon from "./index";

describe("public API runtime surface", () => {
  it("re-exports every documented runtime symbol from the package root", () => {
    const runtimeExports: Array<[string, unknown]> = [
      ["createPaymentReconciler", recon.createPaymentReconciler],
      ["createReconciliationScheduler", recon.createReconciliationScheduler],
      ["deriveReconciliationJobKey", recon.deriveReconciliationJobKey],
      ["createExponentialBackoff", recon.createExponentialBackoff],
      ["decideReconciliationPolicy", recon.decideReconciliationPolicy],
      ["decideReconciliationAction", recon.decideReconciliationAction],
      ["shouldForbidReplacementCharge", recon.shouldForbidReplacementCharge],
      ["compareSnapshots", recon.compareSnapshots],
      ["comparePaymentSnapshots", recon.comparePaymentSnapshots],
      ["moneyEquals", recon.moneyEquals],
      ["resolveProviderSnapshot", recon.resolveProviderSnapshot],
      ["safeLookup", recon.safeLookup],
      ["createGetPaymentLookupPort", recon.createGetPaymentLookupPort],
      ["sanitizeReconciliationError", recon.sanitizeReconciliationError],
      ["DEFAULT_SANITIZE_MAX_LENGTH", recon.DEFAULT_SANITIZE_MAX_LENGTH],
      ["StoreLeaseLostError", recon.StoreLeaseLostError],
      ["isStoreLeaseLostError", recon.isStoreLeaseLostError],
      ["buildLocalPaymentSnapshot", recon.buildLocalPaymentSnapshot],
      ["buildReconciliationTarget", recon.buildReconciliationTarget],
      ["buildProviderPaymentSnapshot", recon.buildProviderPaymentSnapshot],
    ];

    for (const [name, value] of runtimeExports) {
      expect(value, `missing export: ${name}`).toBeDefined();
    }

    expect(typeof recon.createPaymentReconciler).toBe("function");
    expect(typeof recon.createReconciliationScheduler).toBe("function");
    expect(typeof recon.createExponentialBackoff).toBe("function");
    expect(typeof recon.decideReconciliationPolicy).toBe("function");
  });

  it("does not export memory store on public surface", () => {
    expect(
      (recon as Record<string, unknown>).createMemoryReconciliationStore,
    ).toBeUndefined();
  });

  it("StoreLeaseLostError is constructible with code lease_lost", () => {
    const err = new recon.StoreLeaseLostError("test");
    expect(err.code).toBe("lease_lost");
    expect(recon.isStoreLeaseLostError(err)).toBe(true);
  });
});
