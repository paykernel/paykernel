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
   * Handler for each claimed job. Throw → failAndReschedule or markManualReview
   * depending on attempts vs maxAttempts.
   */
  handler: (job: ClaimedJob) => Promise<void>;
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
      const due = await store.listDue({ now, limit });

      // Apply per-gateway caps *before* claim so we never abandon a held lease.
      // Keys from deriveReconciliationJobKey are `recon:gateway:id`.
      const candidates: ReconciliationRecord[] = [];
      if (options.maxInFlightByGateway) {
        const counts: Record<string, number> = {};
        for (const rec of due) {
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
        candidates.push(...due);
      }

      let processed = 0;
      let rescheduled = 0;
      let manualReview = 0;
      let completed = 0;

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
        try {
          await options.handler(job);
          await store.complete({
            key: job.key,
            leaseToken: job.leaseToken,
          });
          completed++;
        } catch (err) {
          if (job.record.attempts >= maxAttempts) {
            const reviewPayload: MarkManualReviewJobInput = {
              key: job.key,
              leaseToken: job.leaseToken,
              note: sanitizeReconciliationError(err),
            };
            await this.markManualReview(reviewPayload);
            manualReview++;
          } else {
            await this.failAndReschedule({
              key: job.key,
              leaseToken: job.leaseToken,
              error: err,
              attempt: job.record.attempts,
            });
            rescheduled++;
          }
        }
      }

      return { processed, rescheduled, manualReview, completed };
    },
  };
}

/** Extract gateway segment from `recon:gateway:id` keys. */
function gatewayFromKey(key: string): string {
  const parts = key.split(":");
  if (parts[0] === "recon" && parts.length >= 3 && parts[1]) {
    return parts[1];
  }
  return "unknown";
}
