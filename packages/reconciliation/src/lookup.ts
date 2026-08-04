/**
 * Safe ordered provider lookup (Phase 19.4).
 *
 * Order when keys + methods present:
 * 1. gatewayPaymentId → findByPaymentId
 * 2. idempotencyKey → findByIdempotencyKey
 * 3. localReference → findByLocalReference
 * 4. providerRequestId → findByProviderRequestId
 *
 * Multi-match → ambiguous_match immediately (never pick-first).
 * Capability-aware: skip undefined methods; never invent results.
 */

import type {
  ProviderPaymentSnapshot,
  ReconciliationResult,
  ReconciliationTarget,
} from "./types";
import { compareSnapshots } from "./compare";

// ─── Port ────────────────────────────────────────────────────────────────────

/**
 * Outcome of a single lookup method invocation.
 * Engine handles 0/1/N snapshots in `found`.
 */
export type LookupOutcome =
  | { kind: "found"; snapshots: ProviderPaymentSnapshot[] }
  | { kind: "not_found" }
  | { kind: "unavailable"; retryAfterMs?: number }
  | { kind: "error"; retryable: boolean; message?: string };

/**
 * Injectable gateway-agnostic provider lookup port.
 * Each method is optional — capability-aware engine skips missing methods.
 */
export type ProviderLookupPort = {
  findByPaymentId?(
    gateway: string,
    id: string,
  ): Promise<LookupOutcome>;
  findByIdempotencyKey?(
    gateway: string,
    key: string,
  ): Promise<LookupOutcome>;
  findByLocalReference?(
    gateway: string,
    ref: string,
  ): Promise<LookupOutcome>;
  findByProviderRequestId?(
    gateway: string,
    id: string,
  ): Promise<LookupOutcome>;
};

type LookupStep = {
  name: string;
  key: string | undefined;
  method:
    | ((gateway: string, id: string) => Promise<LookupOutcome>)
    | undefined;
};

/**
 * Resolve a provider snapshot for a target using safe ordered lookup.
 * Returns a full {@link ReconciliationResult} including compare when expected present.
 */
export async function resolveProviderSnapshot(
  target: ReconciliationTarget,
  lookup: ProviderLookupPort,
): Promise<ReconciliationResult> {
  const steps: LookupStep[] = [
    {
      name: "gatewayPaymentId",
      key: target.gatewayPaymentId,
      method: lookup.findByPaymentId?.bind(lookup),
    },
    {
      name: "idempotencyKey",
      key: target.idempotencyKey,
      method: lookup.findByIdempotencyKey?.bind(lookup),
    },
    {
      name: "localReference",
      key: target.localReference,
      method: lookup.findByLocalReference?.bind(lookup),
    },
    {
      name: "providerRequestId",
      key: target.providerRequestId,
      method: lookup.findByProviderRequestId?.bind(lookup),
    },
  ];

  const keysPresent = steps.filter((s) => s.key !== undefined && s.key !== "");
  if (keysPresent.length === 0) {
    return {
      outcome: "manual_review_required",
      reason:
        "No lookup keys present on target (need gatewayPaymentId, idempotencyKey, localReference, or providerRequestId)",
    };
  }

  const runnable = keysPresent.filter((s) => typeof s.method === "function");
  if (runnable.length === 0) {
    const keyNames = keysPresent.map((s) => s.name).join(", ");
    return {
      outcome: "manual_review_required",
      reason: `No lookup methods implemented for available keys: ${keyNames}`,
    };
  }

  for (const step of runnable) {
    const key = step.key as string;
    const method = step.method as (
      gateway: string,
      id: string,
    ) => Promise<LookupOutcome>;

    let outcome: LookupOutcome;
    try {
      outcome = await method(target.gateway, key);
    } catch {
      // Unexpected throw → temporarily_unavailable (never invent failed)
      return { outcome: "temporarily_unavailable" };
    }

    if (outcome.kind === "found") {
      if (outcome.snapshots.length === 0) {
        // Treat empty found as not_found — continue
        continue;
      }
      if (outcome.snapshots.length > 1) {
        return {
          outcome: "ambiguous_match",
          matches: outcome.snapshots,
        };
      }
      const provider = outcome.snapshots[0]!;
      return finalizeWithExpected(target, provider);
    }

    if (outcome.kind === "not_found") {
      continue;
    }

    if (outcome.kind === "unavailable") {
      const result: ReconciliationResult = {
        outcome: "temporarily_unavailable",
      };
      if (outcome.retryAfterMs !== undefined) {
        result.retryAfterMs = outcome.retryAfterMs;
      }
      return result;
    }

    // error
    if (outcome.retryable) {
      // Do not invent paid/failed; do not continue past retryable provider errors
      // (next keys might race against a flaky primary).
      return { outcome: "temporarily_unavailable" };
    }

    // Non-retryable on this method (e.g. unsupported key shape): try next method.
    continue;
  }

  // All supported steps exhausted as not_found (or non-retryable method errors)
  return {
    outcome: "provider_not_found",
    retryable: true,
  };
}

/** Alias for public API. */
export const safeLookup = resolveProviderSnapshot;

function finalizeWithExpected(
  target: ReconciliationTarget,
  provider: ProviderPaymentSnapshot,
): ReconciliationResult {
  const differences = compareSnapshots(target.expected, provider);
  if (differences.length === 0) {
    return { outcome: "consistent", provider };
  }
  return {
    outcome: "drift_detected",
    provider,
    differences,
  };
}
