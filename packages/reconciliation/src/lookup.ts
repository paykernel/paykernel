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

  // RECON-3: when primary gatewayPaymentId returns definitive not_found, later
  // secondary-key hits must not expose a *different* payment as the canonical
  // provider snapshot (wrong-charge fulfillment / dual-write footgun). Same-id
  // recovery via secondary is still allowed (eventual consistency).
  let primaryPaymentIdNotFound = false;

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
        // Treat empty found as not_found — continue (and track primary).
        if (step.name === "gatewayPaymentId") {
          primaryPaymentIdNotFound = true;
        }
        continue;
      }
      if (outcome.snapshots.length > 1) {
        return {
          outcome: "ambiguous_match",
          matches: outcome.snapshots,
        };
      }
      const provider = outcome.snapshots[0]!;

      // RECON-3: after primary id not_found, refuse foreign secondary snapshots.
      if (
        primaryPaymentIdNotFound &&
        target.gatewayPaymentId !== undefined &&
        target.gatewayPaymentId !== "" &&
        provider.gatewayPaymentId !== target.gatewayPaymentId
      ) {
        return {
          outcome: "manual_review_required",
          reason:
            "Primary gatewayPaymentId was not_found but a secondary key resolved a different payment — do not expose foreign provider snapshot; manual identity review required",
        };
      }

      return finalizeWithExpected(target, provider);
    }

    if (outcome.kind === "not_found") {
      if (step.name === "gatewayPaymentId") {
        primaryPaymentIdNotFound = true;
      }
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
    // Do not mark primary as not_found for format errors — secondary may recover
    // the same identity when the primary method cannot parse the key shape.
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

  // RECON-1 / RECON-3: Always bind provider identity to target.gatewayPaymentId
  // when the app already knows the intended provider payment. Secondary-key
  // hits that resolve a *different* payment must never surface as a usable
  // consistent/drift provider snapshot (apps reading result.provider could
  // fulfill the wrong charge). Escalate without attaching the foreign snapshot.
  if (
    target.gatewayPaymentId !== undefined &&
    target.gatewayPaymentId !== "" &&
    target.gatewayPaymentId !== provider.gatewayPaymentId
  ) {
    return {
      outcome: "manual_review_required",
      reason:
        "Lookup resolved a payment whose gatewayPaymentId does not match the target — do not expose foreign provider snapshot; manual identity review required",
    };
  }

  if (differences.length === 0) {
    return { outcome: "consistent", provider };
  }
  return {
    outcome: "drift_detected",
    provider,
    differences,
  };
}
