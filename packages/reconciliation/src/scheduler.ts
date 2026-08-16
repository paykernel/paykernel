/**
 * Durable reconciliation scheduler over ReconciliationStore (Phase 19.6).
 *
 * No queue product required. Uses store.schedule / listDue / claim / complete /
 * fail / markManualReview. Atomic claim only via store.claim.
 */

import type { ReconciliationTarget } from "./types";
import type {
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
 * Explicit disposition from a processDue handler (RECON-2 / RECON-3).
 *
 * Completing a job requires `{ disposition: "complete" }`. Returning void is
 * treated as retry (fail-closed) so policy outcomes like `retry_later` cannot
 * silently terminate recovery when the handler forgets to throw.
 *
 * `{ disposition: "retry_later" }` is in-flight settlement (policy
 * `retry_later`) — it reschedules and does **not** consume the maxAttempts
 * manual-review / dead-letter budget. Use `{ disposition: "retry" }` for
 * handler/transient failures that should dead-letter at maxAttempts.
 */
export type ProcessDueDisposition =
  | { disposition: "complete" }
  | {
      disposition: "retry";
      error?: unknown;
      /** Optional override delay; when omitted, exponential backoff is used. */
      retryAfterMs?: number;
    }
  | {
      disposition: "retry_later";
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
   * Optional per-gateway max in-flight claims on this scheduler instance
   * (shared across overlapping `processDue` calls). Not a store-wide
   * multi-worker semaphore — bound workers at the app layer for that.
   */
  maxInFlightByGateway?: Record<string, number>;
  /**
   * Handler for each claimed job.
   *
   * - Return `{ disposition: "complete" }` to mark the job completed.
   * - Return `{ disposition: "retry" }` or throw → failAndReschedule (or
   *   markManualReview when attempts ≥ maxAttempts). Hang past the lease
   *   still calls fail so attempts can budget (RECON-LEASE-1).
   * - Return `{ disposition: "retry_later" }` → failAndReschedule **without**
   *   consuming the maxAttempts dead-letter budget (RECON-3 — in-flight
   *   settlement must not park after ~10 claims).
   * - Return `{ disposition: "manual_review" }` to dead-letter without counting
   *   as a transient failure path.
   * - Return `void` / `undefined` → treated as retry (fail-closed; RECON-2).
   */
  handler: (job: ClaimedJob) => Promise<ProcessDueDisposition | void>;
};

/**
 * Result of {@link ReconciliationScheduler.processDue}.
 *
 * `leaseLost` is a foreign reclaim (another worker owns the lease).
 * `hangOverrun` is a same-worker handler overrun whose complete/fail/
 * markManualReview was rejected after expiry without a foreign owner —
 * not a free infinite reclaim (RECON-LEASE-1).
 */
export type ProcessDueResult = {
  processed: number;
  rescheduled: number;
  manualReview: number;
  completed: number;
  /** Jobs where complete/fail fencing rejected (another worker owns the lease). */
  leaseLost: number;
  /**
   * Handler returned/threw after lease expiry and the terminal mutation
   * was rejected without a foreign reclaim. Instance hang budget parks
   * the key at `maxAttempts` even when `fail` still returns `lease_lost`
   * (token already wiped by `listDue`).
   */
  hangOverrun: number;
};

/** PERF-7: never oversample `listDue` beyond this when applying gateway caps. */
const LIST_DUE_OVERSAMPLE_CAP = 200;

/**
 * PERF-7 / claimDue: list is discovery only; claim is the fence. Issue listed
 * claims concurrently, then return acquired jobs in list order.
 *
 * `processDue` must **not** use this — serial handlers would hold N unexpired
 * leases (NEW-RECON-2 / same class as NEW-WEBHOOKS-1).
 */
async function claimListedDue(
  store: ReconciliationStore,
  records: ReconciliationRecord[],
  owner: string,
  leaseMs: number,
): Promise<ClaimedJob[]> {
  const results = await Promise.all(
    records.map((rec) =>
      store.claim({
        key: rec.key,
        owner,
        leaseMs,
      }),
    ),
  );
  const claimed: ClaimedJob[] = [];
  for (const result of results) {
    if (result.kind === "acquired") {
      claimed.push({
        key: result.record.key,
        leaseToken: result.leaseToken,
        record: result.record,
      });
    }
  }
  return claimed;
}

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
   * Inspect dead-letter / `manual_review` / `failed` jobs.
   * Uses `keys`, `scan()`, or store.`listTerminal` when implemented.
   */
  listDeadLetter(
    options?: ListDeadLetterOptions,
  ): Promise<ReconciliationRecord[]>;
  /**
   * Claim due and run handler; reschedule or markManualReview on failure.
   * Documents per-provider concurrency via maxInFlightByGateway.
   */
  processDue(options: ProcessDueOptions): Promise<ProcessDueResult>;
  readonly store: ReconciliationStore;
  readonly maxAttempts: number;
};

/**
 * Create a high-level scheduler wrapping ReconciliationStore.
 *
 * Crash boundaries: see docs/crash-boundaries.md.
 * - schedule is idempotent by key (already_exists).
 * - claim is atomic via store.claim only.
 * - complete / markManualReview require an active leaseToken.
 * - fail records with a matching claimed token even after expiry (RECON-LEASE-1).
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
  const liveByGateway: Record<string, number> = {};
  /** Per-key hang count on this instance (RECON-LEASE-1 backstop). */
  const hangByKey: Record<string, number> = {};

  const addLive = (gateway: string, delta: number): void => {
    liveByGateway[gateway] = Math.max(0, (liveByGateway[gateway] ?? 0) + delta);
  };

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
      return claimListedDue(store, due, owner, leaseMs);
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
      const pushTerminal = (rec: ReconciliationRecord): void => {
        if (rec.status !== "manual_review" && rec.status !== "failed") return;
        if (!out.some((r) => r.key === rec.key)) out.push(rec);
      };
      if (options.keys) {
        for (const key of options.keys) {
          const rec = await store.get(key);
          if (rec) pushTerminal(rec);
        }
      }
      if (options.scan) {
        const scanned = await options.scan();
        for (const rec of scanned) pushTerminal(rec);
      }
      if (!options.keys && !options.scan && store.listTerminal) {
        const scanned = await store.listTerminal();
        for (const rec of scanned) pushTerminal(rec);
      }
      return out;
    },

    async processDue(options: ProcessDueOptions): Promise<ProcessDueResult> {
      const owner = options.owner ?? defaultOwner;
      const leaseMs = options.leaseMs ?? defaultLeaseMs;
      const limit = options.limit ?? 10;
      const now = new Date(clock.nowMs()).toISOString();

      // RECON-8 / PERF-7: list is discovery only; claim is the fence.
      // When per-gateway caps are set, oversample listDue so a cap-dominated
      // prefix cannot starve other gateways — never above LIST_DUE_OVERSAMPLE_CAP (200).
      // NEW-RECON-2: processDue claims one-at-a-time (handlers are serial).
      // Bulk-claiming the candidate list would hold N leases across the first
      // handler and let a peer reclaim after expiry.
      const fetchLimit =
        options.maxInFlightByGateway !== undefined
          ? Math.min(
              LIST_DUE_OVERSAMPLE_CAP,
              Math.max(limit * 3, limit + 16),
            )
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
            const n = (counts[gateway] ?? 0) + (liveByGateway[gateway] ?? 0);
            if (n >= max) continue;
            counts[gateway] = (counts[gateway] ?? 0) + 1;
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
      let hangOverrun = 0;

      const parkHangBudget = async (job: ClaimedJob): Promise<boolean> => {
        const reclaim = await store.claim({
          key: job.key,
          owner,
          leaseMs,
        });
        if (reclaim.kind !== "acquired") return false;
        await this.markManualReview({
          key: reclaim.record.key,
          leaseToken: reclaim.leaseToken,
          note: sanitizeReconciliationError(
            "processDue handler overran lease repeatedly (hang budget)",
          ),
        });
        delete hangByKey[job.key];
        return true;
      };

      for (const rec of candidates) {
        // NEW-RECON-2: claim one-at-a-time so serial handlers do not hold
        // N unexpired leases (peer reclaim + this worker still handles).
        const claim = await store.claim({
          key: rec.key,
          owner,
          leaseMs,
        });
        if (claim.kind !== "acquired") continue;

        const job: ClaimedJob = {
          key: claim.record.key,
          leaseToken: claim.leaseToken,
          record: claim.record,
        };

        const claimedGateway = gatewayFromKey(job.key);
        addLive(claimedGateway, 1);
        processed++;

        const priorHangs = hangByKey[job.key] ?? 0;
        let skipAttemptBudget = false;

        try {
          // RECON-LEASE-1: prior hang/lease_lost without a recorded fail —
          // park on a fresh lease so maxAttempts is not a no-op.
          if (priorHangs >= maxAttempts) {
            await this.markManualReview({
              key: job.key,
              leaseToken: job.leaseToken,
              note: sanitizeReconciliationError(
                "processDue handler overran lease repeatedly (hang budget)",
              ),
            });
            delete hangByKey[job.key];
            addLive(claimedGateway, -1);
            manualReview++;
            continue;
          }

          let disposition: ProcessDueDisposition;
          try {
            const raw = await options.handler(job);
            disposition = normalizeHandlerDisposition(raw);
          } catch (err) {
            disposition = { disposition: "retry", error: err };
          }

          if (disposition.disposition === "complete") {
            await store.complete({
              key: job.key,
              leaseToken: job.leaseToken,
            });
            delete hangByKey[job.key];
            addLive(claimedGateway, -1);
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
            delete hangByKey[job.key];
            addLive(claimedGateway, -1);
            manualReview++;
            continue;
          }

          // RECON-3: in-flight retry_later must not dead-letter at maxAttempts.
          // Settlement (bank transfer / 3DS / async) can outlive the default
          // 10-claim budget; parking would leave local pending after provider paid.
          skipAttemptBudget = disposition.disposition === "retry_later";

          // retry (explicit, retry_later, or fail-closed void / throw)
          if (!skipAttemptBudget && job.record.attempts >= maxAttempts) {
            const reviewPayload: MarkManualReviewJobInput = {
              key: job.key,
              leaseToken: job.leaseToken,
              note: sanitizeReconciliationError(
                disposition.error ?? "processDue handler requested retry at max attempts",
              ),
            };
            await this.markManualReview(reviewPayload);
            delete hangByKey[job.key];
            addLive(claimedGateway, -1);
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
            delete hangByKey[job.key];
            rescheduled++;
            addLive(claimedGateway, -1);
          } else {
            // RECON-LEASE-1: fail after hang/throw so attempts can reach
            // maxAttempts when the adapter accepts fail-after-expiry.
            await this.failAndReschedule({
              key: job.key,
              leaseToken: job.leaseToken,
              error:
                disposition.error ??
                "processDue handler did not return explicit complete disposition",
              attempt: job.record.attempts,
            });
            delete hangByKey[job.key];
            rescheduled++;
            addLive(claimedGateway, -1);
          }
        } catch (err) {
          addLive(claimedGateway, -1);
          if (!isStoreLeaseLostError(err)) {
            throw err;
          }

          // RECON-3: foreign reclaim after a successful handler (or during
          // terminal mutation) is not a business failure / dead-letter.
          // RECON-LEASE-1: same-worker hang after expiry (token still ours,
          // or listDue already wiped it) is not a free infinite reclaim.
          let foreign = false;
          try {
            const after = await store.get(job.key);
            foreign = isForeignLeaseOwner(after, job.leaseToken);
          } catch {
            foreign = true;
          }
          if (foreign) {
            leaseLost++;
            continue;
          }

          hangByKey[job.key] = priorHangs + 1;
          hangOverrun++;

          const budgeted =
            hangByKey[job.key]! >= maxAttempts ||
            (!skipAttemptBudget && job.record.attempts >= maxAttempts);
          if (!budgeted) continue;

          try {
            if (await parkHangBudget(job)) {
              manualReview++;
            }
          } catch (parkErr) {
            if (isStoreLeaseLostError(parkErr)) {
              leaseLost++;
              continue;
            }
            throw parkErr;
          }
        }
      }

      return {
        processed,
        rescheduled,
        manualReview,
        completed,
        leaseLost,
        hangOverrun,
      };
    },
  };
}

/**
 * True when another worker already owns or finished the job.
 * Scheduled / still-claimed-with-our-token after expiry is a hang, not stolen.
 */
function isForeignLeaseOwner(
  rec: ReconciliationRecord | undefined,
  ourToken: LeaseToken,
): boolean {
  if (!rec) return true;
  if (
    rec.status === "completed" ||
    rec.status === "failed" ||
    rec.status === "manual_review"
  ) {
    return true;
  }
  if (
    rec.status === "claimed" &&
    rec.leaseToken !== undefined &&
    rec.leaseToken !== ourToken
  ) {
    return true;
  }
  return false;
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
    raw.disposition === "retry_later" ||
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
