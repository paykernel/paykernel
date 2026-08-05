/**
 * NON-PRODUCTION / NON-DISTRIBUTED in-memory WebhookInboxStore for package tests.
 *
 * Mirrors Phase 9 testkit semantics (atomic claim, lease fencing, generation
 * rotation) so engine tests stay independent of `@paykernel/testkit`.
 *
 * **Dual surface:** testkit ships its own `createMemoryWebhookInboxStore`. The
 * two implementations are intentional for package isolation and **can drift**
 * on SQL-fencing nuances. Neither is production. Apps inject durable
 * `@paykernel/store-*` adapters.
 *
 * ⚠️ Do not use in production payment paths. Not exported from public index.
 */

import {
  StoreLeaseLostError,
  type ClaimWebhookInput,
  type ClaimWebhookResult,
  type CleanupInput,
  type CleanupResult,
  type CompleteWebhookInput,
  type FailWebhookInput,
  type ListRetryableInput,
  type RenewWebhookLeaseInput,
  type RenewWebhookLeaseResult,
  type WebhookEventKey,
  type WebhookInboxRecord,
  type WebhookInboxStore,
} from "./store";

type MemoryClock = {
  nowMs(): number;
};

export type MemoryWebhookInboxStore = WebhookInboxStore & {
  readonly NON_PRODUCTION: true;
  readonly NON_DISTRIBUTED: true;
  /** Test helper: arm next mutation to throw before apply. */
  simulateCrash(options?: { sticky?: boolean; message?: string }): void;
  clear(): void;
  readonly size: number;
};

export type CreateMemoryWebhookInboxStoreOptions = {
  clock?: MemoryClock;
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
 * Create an in-memory webhook inbox store (tests only).
 *
 * @remarks NON-PRODUCTION. Single-isolate. Not multi-process safe.
 */
export function createMemoryWebhookInboxStore(
  options: CreateMemoryWebhookInboxStoreOptions = {},
): MemoryWebhookInboxStore {
  const clock = options.clock ?? systemClock;
  const maxEntries = options.maxEntries;
  const entries = new Map<WebhookEventKey, WebhookInboxRecord>();
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
    key: WebhookEventKey,
    rec: WebhookInboxRecord,
  ): WebhookInboxRecord {
    if (
      rec.status === "claimed" &&
      rec.leaseExpiresAt &&
      Date.parse(rec.leaseExpiresAt) <= clock.nowMs()
    ) {
      // WEBHOOKS-1: crash/deploy reclaim must not burn the maxAttempts handler
      // budget. This claim never completed via fail/complete (handler outcome),
      // so restore the claim's attempt++ before exposing the row as pending.
      // Soft-release is the only safe place: get/listRetryable may release
      // before the next claim, so claim-time detection alone is insufficient.
      const released: WebhookInboxRecord = {
        ...rec,
        status: "pending",
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        attempts: Math.max(0, rec.attempts - 1),
        availableAt: iso(clock),
        updatedAt: iso(clock),
      };
      entries.set(key, released);
      return released;
    }
    return rec;
  }

  function enforceCap(newKey: WebhookEventKey): void {
    if (maxEntries === undefined) return;
    if (entries.has(newKey)) return;
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  const store: MemoryWebhookInboxStore = {
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
      const snap = new Map<WebhookEventKey, WebhookInboxRecord>();
      for (const [k, v] of entries) {
        snap.set(k, structuredClone(v));
      }
      try {
        return await fn();
      } catch (err) {
        entries.clear();
        for (const [k, v] of snap) {
          entries.set(k, structuredClone(v));
        }
        throw err;
      }
    },

    async claim(input: ClaimWebhookInput): Promise<ClaimWebhookResult> {
      maybeCrash();
      const existing = entries.get(input.key);
      // Soft-release at most once; never re-apply against a stale pre-release snapshot
      // (that would re-use the old attempts value and can desync the handler budget).
      const base = existing
        ? releaseExpiredLease(input.key, existing)
        : undefined;
      if (base) {
        // WEBHOOKS-4: terminal outcomes win before payload_hash_conflict so a
        // completed/dead-lettered row redelivered with a mismatched hash (e.g.
        // rawBody vs object hash footgun) still ACKs as already done / failed
        // rather than permanent payload_conflict that never re-runs a terminal
        // idempotent path.
        if (base.status === "completed") {
          return { kind: "already_completed", record: base };
        }
        if (base.status === "dead_letter" || base.status === "failed") {
          return { kind: "duplicate_failed", record: base };
        }
        // Active lease: same hash → in_progress; different hash cannot supersede.
        if (base.status === "claimed" && isLeaseActive(base, clock)) {
          if (base.payloadHash !== input.payloadHash) {
            return { kind: "payload_hash_conflict", record: base };
          }
          return { kind: "in_progress", record: base };
        }
        // Same-hash backoff only. Idle hash mismatch falls through and
        // supersedes so raw-string vs object digests do not stick redrive.
        if (
          base.payloadHash === input.payloadHash &&
          base.status === "pending" &&
          Date.parse(base.availableAt) > clock.nowMs()
        ) {
          return {
            kind: "not_available",
            record: base,
            availableAt: base.availableAt,
          };
        }
      }

      enforceCap(input.key);
      const generation = (base?.generation ?? 0) + 1;
      const leaseToken = newLeaseToken(clock, generation);
      const now = iso(clock);
      // base already passed availableAt / terminal / hash gates (or is new).
      // Pending reclaim burns an attempt; expired-claimed soft-release restored one
      // so this +1 returns the counter to the unfinished-handler budget (WEBHOOKS-1).
      const record: WebhookInboxRecord = {
        key: input.key,
        status: "claimed",
        payloadHash: input.payloadHash,
        payloadRef: input.payloadRef ?? base?.payloadRef,
        leaseOwner: input.owner,
        leaseToken,
        leaseExpiresAt: new Date(clock.nowMs() + input.leaseMs).toISOString(),
        attempts: (base?.attempts ?? 0) + 1,
        createdAt: base?.createdAt ?? now,
        updatedAt: now,
        availableAt: now,
        generation,
      };
      entries.set(input.key, record);
      return { kind: "acquired", record, leaseToken };
    },

    async renew(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult> {
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
      const updated: WebhookInboxRecord = {
        ...rec,
        leaseToken,
        leaseExpiresAt: new Date(clock.nowMs() + input.leaseMs).toISOString(),
        generation,
        updatedAt: iso(clock),
      };
      entries.set(input.key, updated);
      return { ok: true, record: updated, leaseToken };
    },

    async complete(input: CompleteWebhookInput): Promise<void> {
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

    async fail(input: FailWebhookInput): Promise<void> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (!existing) throw new StoreLeaseLostError("fail: key not found");
      const rec = releaseExpiredLease(input.key, existing);
      if (rec.status !== "claimed" || rec.leaseToken !== input.leaseToken) {
        throw new StoreLeaseLostError("fail: lease token rejected");
      }
      const retryAfterMs = input.retryAfterMs ?? 0;
      const dead = input.deadLetter === true;
      const attempts =
        input.restoreAttempt === true
          ? Math.max(0, rec.attempts - 1)
          : rec.attempts;
      entries.set(input.key, {
        ...rec,
        status: dead ? "dead_letter" : "pending",
        lastError: input.error,
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        attempts,
        availableAt: new Date(clock.nowMs() + retryAfterMs).toISOString(),
        updatedAt: iso(clock),
      });
    },

    async get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined> {
      const existing = entries.get(key);
      if (!existing) return undefined;
      return releaseExpiredLease(key, existing);
    },

    async listRetryable(input: ListRetryableInput): Promise<WebhookInboxRecord[]> {
      const nowMs = input.now ? Date.parse(input.now) : clock.nowMs();
      const limit = input.limit ?? 100;
      const out: WebhookInboxRecord[] = [];
      for (const [key, raw] of entries) {
        const rec = releaseExpiredLease(key, raw);
        if (rec.status !== "pending") continue;
        if (Date.parse(rec.availableAt) > nowMs) continue;
        out.push(rec);
        if (out.length >= limit) break;
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
          (rec.status === "completed" || rec.status === "dead_letter")
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
