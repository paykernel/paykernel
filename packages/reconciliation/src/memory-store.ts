/**
 * NON-PRODUCTION / NON-DISTRIBUTED in-memory ReconciliationStore for package tests.
 *
 * Mirrors Phase 9 testkit semantics (atomic claim, lease fencing, generation
 * rotation) so domain tests stay independent of `@paykernel/testkit`.
 *
 * **Dual surface:** testkit ships its own `createMemoryReconciliationStore`. The
 * two implementations are intentional for package isolation and **can drift**
 * on SQL-fencing nuances. Neither is production. Apps inject durable
 * `@paykernel/store-*` adapters.
 *
 * ⚠️ Do not use in production payment paths. Not exported from public index.
 */

import {
  StoreLeaseLostError,
  type ClaimReconciliationInput,
  type ClaimResult,
  type CleanupInput,
  type CleanupResult,
  type CompleteReconciliationInput,
  type FailReconciliationInput,
  type ListDueInput,
  type MarkManualReviewInput,
  type ReconciliationKey,
  type ReconciliationRecord,
  type ReconciliationStore,
  type RenewReconciliationLeaseInput,
  type RenewReconciliationLeaseResult,
  type ScheduleReconciliationInput,
  type ScheduleResult,
} from "./store";

type MemoryClock = {
  nowMs(): number;
};

export type MemoryReconciliationStore = ReconciliationStore & {
  readonly NON_PRODUCTION: true;
  readonly NON_DISTRIBUTED: true;
  simulateCrash(options?: { sticky?: boolean; message?: string }): void;
  clear(): void;
  readonly size: number;
};

export type CreateMemoryReconciliationStoreOptions = {
  clock?: MemoryClock;
  /**
   * Test-only cap. Must not evict `claimed` rows with an active lease —
   * skip those victims or refuse the new write (NEW-STORE-2).
   */
  maxEntries?: number;
};

const systemClock: MemoryClock = { nowMs: () => Date.now() };

function newLeaseToken(clock: MemoryClock, generation: number): string {
  return `lease_${clock.nowMs()}_${generation}_${Math.random().toString(36).slice(2, 12)}`;
}

function iso(clock: MemoryClock): string {
  return new Date(clock.nowMs()).toISOString();
}

function isLeaseActive(
  record: { leaseExpiresAt?: string | undefined },
  clock: MemoryClock,
): boolean {
  if (!record.leaseExpiresAt) return false;
  return Date.parse(record.leaseExpiresAt) > clock.nowMs();
}

/**
 * Create an in-memory reconciliation store (tests only).
 *
 * @remarks NON-PRODUCTION. Single-isolate. Not multi-process safe.
 */
export function createMemoryReconciliationStore(
  options: CreateMemoryReconciliationStoreOptions = {},
): MemoryReconciliationStore {
  const clock = options.clock ?? systemClock;
  const maxEntries = options.maxEntries;
  const entries = new Map<ReconciliationKey, ReconciliationRecord>();
  let crash: { failNextMutation: boolean; sticky: boolean; message: string } = {
    failNextMutation: false,
    sticky: false,
    message: "Simulated memory-store crash boundary",
  };

  function maybeCrash(): void {
    if (!crash.failNextMutation) return;
    if (!crash.sticky) {
      crash = { ...crash, failNextMutation: false };
    }
    throw new Error(crash.message);
  }

  function releaseExpiredLease(
    key: ReconciliationKey,
    rec: ReconciliationRecord,
  ): ReconciliationRecord {
    if (
      rec.status === "claimed" &&
      rec.leaseExpiresAt &&
      Date.parse(rec.leaseExpiresAt) <= clock.nowMs()
    ) {
      // STORES-1: restore unfinished claim so crash/listDue reclaim does not
      // burn maxAttempts (parity with SQL CASE WHEN status=claimed THEN attempts).
      const released: ReconciliationRecord = {
        ...rec,
        status: "scheduled",
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        attempts: Math.max(0, rec.attempts - 1),
        updatedAt: iso(clock),
      };
      entries.set(key, released);
      return released;
    }
    return rec;
  }

  function enforceCap(newKey: ReconciliationKey): void {
    if (maxEntries === undefined) return;
    if (entries.has(newKey)) return;
    while (entries.size >= maxEntries) {
      let victim: ReconciliationKey | undefined;
      for (const [key, rec] of entries) {
        // NEW-STORE-2: never FIFO-evict a live claimed lease.
        if (rec.status === "claimed" && isLeaseActive(rec, clock)) continue;
        victim = key;
        break;
      }
      if (victim === undefined) {
        throw new Error(
          "memory store at capacity: refusing to evict claimed row with active lease",
        );
      }
      entries.delete(victim);
    }
  }

  const store: MemoryReconciliationStore = {
    NON_PRODUCTION: true,
    NON_DISTRIBUTED: true,

    get size() {
      return entries.size;
    },

    clear() {
      entries.clear();
    },

    simulateCrash(opts) {
      crash = {
        failNextMutation: true,
        sticky: opts?.sticky === true,
        message: opts?.message ?? crash.message,
      };
    },

    async withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
      maybeCrash();
      const snap = new Map(entries);
      try {
        return await fn();
      } catch (err) {
        entries.clear();
        for (const [k, v] of snap) entries.set(k, v);
        throw err;
      }
    },

    async schedule(input: ScheduleReconciliationInput): Promise<ScheduleResult> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (existing) {
        // RECON-7: terminal jobs may be re-opened under the same key so
        // operators can re-reconcile after completion/dead-letter without
        // minting a new key. Active scheduled/claimed rows stay already_exists.
        if (
          existing.status === "completed" ||
          existing.status === "failed" ||
          existing.status === "manual_review"
        ) {
          const now = iso(clock);
          const record: ReconciliationRecord = {
            key: input.key,
            status: "scheduled",
            subjectId: input.subjectId,
            reason: input.reason,
            attempts: 0,
            dueAt: input.dueAt,
            createdAt: existing.createdAt,
            updatedAt: now,
            generation: existing.generation,
            leaseOwner: undefined,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            lastError: undefined,
          };
          entries.set(input.key, record);
          return { kind: "scheduled", record };
        }
        return { kind: "already_exists", record: existing };
      }
      enforceCap(input.key);
      const now = iso(clock);
      const record: ReconciliationRecord = {
        key: input.key,
        status: "scheduled",
        subjectId: input.subjectId,
        reason: input.reason,
        attempts: 0,
        dueAt: input.dueAt,
        createdAt: now,
        updatedAt: now,
        generation: 0,
      };
      entries.set(input.key, record);
      return { kind: "scheduled", record };
    },

    async claim(input: ClaimReconciliationInput): Promise<ClaimResult> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (!existing) return { kind: "not_found" };
      const rec = releaseExpiredLease(input.key, existing);
      if (
        rec.status === "completed" ||
        rec.status === "failed" ||
        rec.status === "manual_review"
      ) {
        return { kind: "already_terminal", record: rec };
      }
      if (rec.status === "claimed" && isLeaseActive(rec, clock)) {
        return { kind: "in_progress", record: rec };
      }
      if (Date.parse(rec.dueAt) > clock.nowMs()) {
        return { kind: "not_due", record: rec };
      }
      const generation = rec.generation + 1;
      const leaseToken = newLeaseToken(clock, generation);
      // STORES-1: increment only from scheduled. Soft-release restored one
      // attempt, so expired-claimed reclaim nets to the prior count.
      const attempts =
        rec.status === "scheduled" ? rec.attempts + 1 : rec.attempts;
      const updated: ReconciliationRecord = {
        ...rec,
        status: "claimed",
        leaseOwner: input.owner,
        leaseToken,
        leaseExpiresAt: new Date(clock.nowMs() + input.leaseMs).toISOString(),
        attempts,
        generation,
        updatedAt: iso(clock),
      };
      entries.set(input.key, updated);
      return { kind: "acquired", record: updated, leaseToken };
    },

    async renew(
      input: RenewReconciliationLeaseInput,
    ): Promise<RenewReconciliationLeaseResult> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (!existing) return { ok: false, reason: "not_found" };
      const rec = releaseExpiredLease(input.key, existing);
      if (rec.status !== "claimed") return { ok: false, reason: "wrong_status" };
      if (rec.leaseToken !== input.leaseToken || !isLeaseActive(rec, clock)) {
        return { ok: false, reason: "lease_lost" };
      }
      const generation = rec.generation + 1;
      const leaseToken = newLeaseToken(clock, generation);
      const updated: ReconciliationRecord = {
        ...rec,
        leaseToken,
        leaseExpiresAt: new Date(clock.nowMs() + input.leaseMs).toISOString(),
        generation,
        updatedAt: iso(clock),
      };
      entries.set(input.key, updated);
      return { ok: true, record: updated, leaseToken };
    },

    async complete(input: CompleteReconciliationInput): Promise<void> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (!existing) throw new StoreLeaseLostError("complete: key not found");
      const rec = releaseExpiredLease(input.key, existing);
      if (rec.status !== "claimed" || rec.leaseToken !== input.leaseToken) {
        throw new StoreLeaseLostError("complete: lease token rejected");
      }
      if (!isLeaseActive(rec, clock)) {
        throw new StoreLeaseLostError("complete: lease expired");
      }
      entries.set(input.key, {
        ...rec,
        status: "completed",
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: iso(clock),
      });
    },

    async fail(input: FailReconciliationInput): Promise<void> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (!existing) throw new StoreLeaseLostError("fail: key not found");
      // RECON-LEASE-1: accept fail with matching token even after lease expiry.
      // Soft-release-first would clear the token + restore attempts, making
      // maxAttempts a no-op for hang/timeout handlers that still call fail.
      // Crash reclaim (get/listDue) still soft-restores unfinished claims.
      if (
        existing.status !== "claimed" ||
        existing.leaseToken !== input.leaseToken
      ) {
        throw new StoreLeaseLostError("fail: lease token rejected");
      }
      const rec = existing;
      if (input.retryAt !== undefined) {
        entries.set(input.key, {
          ...rec,
          status: "scheduled",
          dueAt: input.retryAt,
          lastError: input.error,
          leaseToken: undefined,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          updatedAt: iso(clock),
        });
        return;
      }
      entries.set(input.key, {
        ...rec,
        status: "failed",
        lastError: input.error,
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: iso(clock),
      });
    },

    async markManualReview(input: MarkManualReviewInput): Promise<void> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (!existing) {
        throw new StoreLeaseLostError("markManualReview: key not found");
      }
      const rec = releaseExpiredLease(input.key, existing);
      if (rec.status !== "claimed" || rec.leaseToken !== input.leaseToken) {
        throw new StoreLeaseLostError("markManualReview: lease token rejected");
      }
      const updated: ReconciliationRecord = {
        ...rec,
        status: "manual_review",
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: iso(clock),
      };
      if (input.note !== undefined) {
        updated.lastError = input.note;
      }
      entries.set(input.key, updated);
    },

    async get(key: ReconciliationKey): Promise<ReconciliationRecord | undefined> {
      const existing = entries.get(key);
      if (!existing) return undefined;
      return releaseExpiredLease(key, existing);
    },

    async listDue(input: ListDueInput): Promise<ReconciliationRecord[]> {
      const nowMs = input.now ? Date.parse(input.now) : clock.nowMs();
      const limit = input.limit ?? 100;
      const out: ReconciliationRecord[] = [];
      for (const [key, raw] of entries) {
        const rec = releaseExpiredLease(key, raw);
        if (rec.status !== "scheduled") continue;
        if (Date.parse(rec.dueAt) > nowMs) continue;
        out.push(rec);
        if (out.length >= limit) break;
      }
      return out;
    },

    async listTerminal(input?: { limit?: number }): Promise<ReconciliationRecord[]> {
      const limit = input?.limit ?? 100;
      const out: ReconciliationRecord[] = [];
      for (const [, rec] of entries) {
        if (rec.status === "manual_review" || rec.status === "failed") {
          out.push(rec);
          if (out.length >= limit) break;
        }
      }
      return out;
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      maybeCrash();
      const before = Date.parse(input.before);
      let deleted = 0;
      const limit = input.limit ?? Number.POSITIVE_INFINITY;
      for (const [key, rec] of entries) {
        if (deleted >= limit) break;
        if (
          Date.parse(rec.updatedAt) <= before &&
          (rec.status === "completed" ||
            rec.status === "failed" ||
            rec.status === "manual_review")
        ) {
          entries.delete(key);
          deleted++;
        }
      }
      return { deleted };
    },
  };

  return store;
}
