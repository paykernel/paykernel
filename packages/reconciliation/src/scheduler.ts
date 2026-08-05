/**
 * Durable reconciliation scheduler over ReconciliationStore (Phase 19.6).
 *
 * No queue product required. Uses store.schedule / listDue / claim / complete /
 * fail / markManualReview. Atomic claim only via store.claim.
 */

import type { ReconciliationTarget } from "./types";
import type {
  ClaimResult,
  IsoTimestamp,
  LeaseToken,
  ReconciliationKey,
  ReconciliationRecord,
  ReconciliationStore,
  ScheduleResult,
} from "./store";
import { isStoreLeaseLostError } from "./store";
import type { ExponentialBackoff } from "./backoff";
import { createExponentialBackoff } from "./backoff";
import { sanitizeReconciliationError } from "./sanitize";

export type SchedulerClock = {
  nowMs(): number;
};

const systemClock: SchedulerClock = { nowMs: () => Date.now() };

export type CreateReconciliationSchedulerOptions = {
  store: ReconciliationStore;
  clock?: SchedulerClock;
  /** Default lease duration for claims (ms). Default 30_000. */
  defaultLeaseMs?: number;
  /** Default claim owner id. Default "reconciliation-worker". */
  owner?: string;
  /** Backoff for failAndReschedule. Default base 1s, max 15m, mult 2, jitter 0.2. */
  backoff?: ExponentialBackoff;
  /**
   * Max claim attempts before markManualReview in process helpers.
   * Default 10. attempt is taken from record.attempts after claim.
   */
  maxAttempts?: number;
};

export type ScheduleJobInput = {
  target: ReconciliationTarget;
  runAt: IsoTimestamp;
  reason: string;
  /** Optional stable key; derived from gateway + primary id when omitted. */
  key?: string;
};

export type ClaimDueOptions = {
  limit?: number;
  owner?: string;
  leaseMs?: number;
};

export type ClaimedJob = {
  key: ReconciliationKey;
  leaseToken: LeaseToken;
  record: ReconciliationRecord;
};

export type FailAndRescheduleInput = {
  key: ReconciliationKey;
  leaseToken: LeaseToken;
  error: unknown;
  /** Attempt index for backoff (typically record.attempts after claim). */
  attempt: number;
};

export type MarkManualReviewJobInput = {
  key: ReconciliationKey;
  leaseToken: LeaseToken;
  note?: string;
};

export type CompleteJobInput = {
  key: ReconciliationKey;
  leaseToken: LeaseToken;
};

export type ListDeadLetterOptions = {
  /** Keys to inspect via get (application supplies known keys or scans). */
  keys?: ReconciliationKey[];
  /**
   * When true, also scan listDue is NOT used for terminal states.
   * Dead-letter inspection relies on get for terminal manual_review/failed
   * jobs the app tracks, or an optional `scan` callback.
   */
  scan?: () => Promise<ReconciliationRecord[]>;
};

/**
 * Explicit disposition from a processDue handler (RECON-2).
 *
 * Completing a job requires `{ disposition: "complete" }`. Returning void is
 * treated as retry (fail-closed) so policy outcomes like `retry_later` cannot
 * silently terminate recovery when the handler forgets to throw.
 */
export type ProcessDueDisposition =
  | { disposition: "complete" }
  | {
      disposition: "retry";
      error?: unknown;
      /** Optional override delay; when omitted, exponential backoff is used. */
      retryAfterMs?: number;
    }
  | { disposition: "manual_review"; note?: string };

export type ProcessDueOptions = {
  limit?: number;
  owner?: string;
  leaseMs?: number;
  /**
   * Optional per-gateway max in-flight claims within this processDue call.
   * Applications should also bound global concurrency at the worker level.
   */
  maxInFlightByGateway?: Record<string, number>;
  /**
   * Handler for each claimed job.
   *
   * - Return `{ disposition: "complete" }` to mark the job completed.
   * - Return `{ disposition: "retry" }` or throw → failAndReschedule (or
   *   markManualReview when attempts ≥ maxAttempts).
   * - Return `{ disposition: "manual_review" }` to dead-letter without counting
   *   as a transient failure path.
   * - Return `void` / `undefined` → treated as retry (fail-closed; RECON-2).
   */
  handler: (job: ClaimedJob) => Promise<ProcessDueDisposition | void>;
};

/**
 * Derive a stable reconciliation job key from target identifiers.
 * Prefer gatewayPaymentId → idempotencyKey → localReference → providerRequestId.
 */
export function deriveReconciliationJobKey(target: ReconciliationTarget): string {
  const id =
    target.gatewayPaymentId ??
    target.idempotencyKey ??
    target.localReference ??
    target.providerRequestId;
  if (!id) {
    throw new Error(
      "Cannot derive reconciliation job key: target has no gatewayPaymentId, idempotencyKey, localReference, or providerRequestId",
    );
  }
  return `recon:${target.gateway}:${id}`;
}

function deriveSubjectId(target: ReconciliationTarget, key: string): string {
  return (
    target.gatewayPaymentId ??
    target.localReference ??
    target.idempotencyKey ??
    target.providerRequestId ??
    key
  );
}

export type ReconciliationScheduler = {
  schedule(input: ScheduleJobInput): Promise<ScheduleResult>;
  /**
   * Claim due jobs: listDue then atomic claim each.
   * Skips not_due / in_progress / already_terminal / not_found.
   */
  claimDue(options?: ClaimDueOptions): Promise<ClaimedJob[]>;
  complete(input: CompleteJobInput): Promise<void>;
  failAndReschedule(input: FailAndRescheduleInput): Promise<void>;
  markManualReview(input: MarkManualReviewJobInput): Promise<void>;
  /**
   * Inspect dead-letter / manual_review jobs.
   * Prefer supplying keys or a scan() that returns candidate records.
   */
  listDeadLetter(
    options?: ListDeadLetterOptions,
  ): Promise<ReconciliationRecord[]>;
  /**
   * Claim due and run handler; reschedule or markManualReview on failure.
   * Documents per-provider concurrency via maxInFlightByGateway.
   */
  processDue(options: ProcessDueOptions): Promise<{
    processed: number;
    rescheduled: number;
    manualReview: number;
    completed: number;
    /** Jobs where complete/fail fencing rejected (another worker owns the lease). */
    leaseLost: number;
  }>;
  readonly store: ReconciliationStore;
  readonly maxAttempts: number;
};

/**
 * Create a high-level scheduler wrapping ReconciliationStore.
 *
 * Crash boundaries: see docs/crash-boundaries.md.
 * - schedule is idempotent by key (already_exists).
 * - claim is atomic via store.claim only.
 * - complete/fail/markManualReview require active leaseToken.
 */
export function createReconciliationScheduler(
  options: CreateReconciliationSchedulerOptions,
): ReconciliationScheduler {
  const store = options.store;
  const clock = options.clock ?? systemClock;
  const defaultLeaseMs = options.defaultLeaseMs ?? 30_000;
  const defaultOwner = options.owner ?? "reconciliation-worker";
  const backoff =
    options.backoff ??
    createExponentialBackoff({
      baseMs: 1_000,
      maxMs: 15 * 60_000,
      multiplier: 2,
      jitterRatio: 0.2,
    });
  const maxAttempts = options.maxAttempts ?? 10;

  return {
    store,
    maxAttempts,

    async schedule(input: ScheduleJobInput): Promise<ScheduleResult> {
      const key = input.key ?? deriveReconciliationJobKey(input.target);
      const subjectId = deriveSubjectId(input.target, key);
      // RECON-7: adapters SHOULD reopen terminal rows (completed/failed/
      // manual_review) as scheduled under the same key. Active rows remain
      // already_exists. See ScheduleResult docs + memory-store reopen.
      return store.schedule({
        key,
        subjectId,
        reason: input.reason,
        dueAt: input.runAt,
      });
    },

    async claimDue(options: ClaimDueOptions = {}): Promise<ClaimedJob[]> {
      const limit = options.limit ?? 10;
      const owner = options.owner ?? defaultOwner;
      const leaseMs = options.leaseMs ?? defaultLeaseMs;
      const now = new Date(clock.nowMs()).toISOString();
      const due = await store.listDue({ now, limit });
      const claimed: ClaimedJob[] = [];

      for (const rec of due) {
        const result: ClaimResult = await store.claim({
          key: rec.key,
          owner,
          leaseMs,
        });
        if (result.kind === "acquired") {
          claimed.push({
            key: result.record.key,
            leaseToken: result.leaseToken,
            record: result.record,
          });
        }
        // not_due / in_progress / already_terminal / not_found → skip
      }
      return claimed;
    },

    async complete(input: CompleteJobInput): Promise<void> {
      await store.complete({
        key: input.key,
        leaseToken: input.leaseToken,
      });
    },

    async failAndReschedule(input: FailAndRescheduleInput): Promise<void> {
      const delay = backoff.nextDelayMs(input.attempt);
      const retryAt = new Date(clock.nowMs() + delay).toISOString();
      const error = sanitizeReconciliationError(input.error);
      await store.fail({
        key: input.key,
        leaseToken: input.leaseToken,
        error,
        retryAt,
      });
    },

    async markManualReview(input: MarkManualReviewJobInput): Promise<void> {
      const payload: {
        key: ReconciliationKey;
        leaseToken: LeaseToken;
        note?: string;
      } = {
        key: input.key,
        leaseToken: input.leaseToken,
      };
      if (input.note !== undefined) {
        payload.note = sanitizeReconciliationError(input.note);
      }
      await store.markManualReview(payload);
    },

    async listDeadLetter(
      options: ListDeadLetterOptions = {},
    ): Promise<ReconciliationRecord[]> {
      const out: ReconciliationRecord[] = [];
      if (options.keys) {
        for (const key of options.keys) {
          const rec = await store.get(key);
          if (
            rec &&
            (rec.status === "manual_review" || rec.status === "failed")
          ) {
            out.push(rec);
          }
        }
      }
      if (options.scan) {
        const scanned = await options.scan();
        for (const rec of scanned) {
          if (rec.status === "manual_review" || rec.status === "failed") {
            if (!out.some((r) => r.key === rec.key)) {
              out.push(rec);
            }
          }
        }
      }
      return out;
    },

    async processDue(options: ProcessDueOptions) {
      const owner = options.owner ?? defaultOwner;
      const leaseMs = options.leaseMs ?? defaultLeaseMs;
      const limit = options.limit ?? 10;
      const now = new Date(clock.nowMs()).toISOString();

      // RECON-8: when per-gateway caps are set, oversample listDue so a
      // cap-dominated prefix cannot starve other gateways within this call.
      const fetchLimit =
        options.maxInFlightByGateway !== undefined
          ? Math.min(1_000, Math.max(limit * 10, limit + 50))
          : limit;
      const due = await store.listDue({ now, limit: fetchLimit });

      // Apply per-gateway caps *before* claim so we never abandon a held lease.
      // Keys from deriveReconciliationJobKey are `recon:gateway:id`.
      const candidates: ReconciliationRecord[] = [];
      if (options.maxInFlightByGateway) {
        const counts: Record<string, number> = {};
        for (const rec of due) {
          if (candidates.length >= limit) break;
          const gateway = gatewayFromKey(rec.key);
          const max = options.maxInFlightByGateway[gateway];
          if (max !== undefined) {
            const n = counts[gateway] ?? 0;
            if (n >= max) continue;
            counts[gateway] = n + 1;
          }
          candidates.push(rec);
        }
      } else {
        candidates.push(...due.slice(0, limit));
      }

      let processed = 0;
      let rescheduled = 0;
      let manualReview = 0;
      let completed = 0;
      let leaseLost = 0;

      for (const rec of candidates) {
        const claimResult: ClaimResult = await store.claim({
          key: rec.key,
          owner,
          leaseMs,
        });
        if (claimResult.kind !== "acquired") continue;

        const job: ClaimedJob = {
          key: claimResult.record.key,
          leaseToken: claimResult.leaseToken,
          record: claimResult.record,
        };
        processed++;

        let disposition: ProcessDueDisposition;
        try {
          const raw = await options.handler(job);
          disposition = normalizeHandlerDisposition(raw);
        } catch (err) {
          disposition = { disposition: "retry", error: err };
        }

        try {
          if (disposition.disposition === "complete") {
            await store.complete({
              key: job.key,
              leaseToken: job.leaseToken,
            });
            completed++;
            continue;
          }

          if (disposition.disposition === "manual_review") {
            const reviewPayload: MarkManualReviewJobInput = {
              key: job.key,
              leaseToken: job.leaseToken,
            };
            if (disposition.note !== undefined) {
              reviewPayload.note = sanitizeReconciliationError(disposition.note);
            }
            await this.markManualReview(reviewPayload);
            manualReview++;
            continue;
          }

          // retry (explicit or fail-closed void / throw)
          if (job.record.attempts >= maxAttempts) {
            const reviewPayload: MarkManualReviewJobInput = {
              key: job.key,
              leaseToken: job.leaseToken,
              note: sanitizeReconciliationError(
                disposition.error ?? "processDue handler requested retry at max attempts",
              ),
            };
            await this.markManualReview(reviewPayload);
            manualReview++;
          } else if (
            disposition.retryAfterMs !== undefined &&
            Number.isFinite(disposition.retryAfterMs) &&
            disposition.retryAfterMs >= 0
          ) {
            const retryAt = new Date(
              clock.nowMs() + disposition.retryAfterMs,
            ).toISOString();
            await store.fail({
              key: job.key,
              leaseToken: job.leaseToken,
              error: sanitizeReconciliationError(
                disposition.error ?? "processDue handler requested retry",
              ),
              retryAt,
            });
            rescheduled++;
          } else {
            await this.failAndReschedule({
              key: job.key,
              leaseToken: job.leaseToken,
              error:
                disposition.error ??
                "processDue handler did not return explicit complete disposition",
              attempt: job.record.attempts,
            });
            rescheduled++;
          }
        } catch (err) {
          // RECON-3: lease_lost after a successful handler (or during terminal
          // mutation) means another worker owns the job — do not treat as a
          // business failure / maxAttempts dead-letter.
          if (isStoreLeaseLostError(err)) {
            leaseLost++;
            continue;
          }
          throw err;
        }
      }

      return { processed, rescheduled, manualReview, completed, leaseLost };
    },
  };
}

/** Only `{ disposition: "complete" }` finishes a job; void → fail-closed retry. */
function normalizeHandlerDisposition(
  raw: ProcessDueDisposition | void,
): ProcessDueDisposition {
  if (raw === undefined) {
    return {
      disposition: "retry",
      error:
        'processDue handler returned no disposition (void); treating as retry — return { disposition: "complete" } to finish',
    };
  }
  if (
    raw.disposition === "complete" ||
    raw.disposition === "retry" ||
    raw.disposition === "manual_review"
  ) {
    return raw;
  }
  return {
    disposition: "retry",
    error:
      "processDue handler returned unrecognized disposition; treating as retry",
  };
}

/**
 * Extract gateway segment for maxInFlightByGateway (RECON-4).
 *
 * Supports:
 * - Canonical `recon:{gateway}:{id}` from {@link deriveReconciliationJobKey}
 * - App-supplied `{gateway}:{id}` shorthand (first non-empty segment)
 *
 * Keys without a gateway segment map to `"unknown"` (shared uncapped bucket
 * unless the app sets `maxInFlightByGateway.unknown`).
 */
function gatewayFromKey(key: string): string {
  const parts = key.split(":").filter((p) => p.length > 0);
  if (parts.length === 0) return "unknown";
  // Canonical: recon:gateway:id
  if (parts[0] === "recon" && parts.length >= 3 && parts[1]) {
    return parts[1];
  }
  // App-supplied gateway:id (or gateway:id:extra) — first segment is gateway.
  // Do not treat bare `recon` / `recon:` as a gateway name.
  if (parts[0] !== "recon" && parts.length >= 2 && parts[0]) {
    return parts[0];
  }
  return "unknown";
}
