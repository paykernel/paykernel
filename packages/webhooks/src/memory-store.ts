/**
 * NON-PRODUCTION / NON-DISTRIBUTED in-memory WebhookInboxStore for package tests.
 *
 * Mirrors Phase 9 testkit semantics (atomic claim, lease fencing, generation
 * rotation) so engine tests stay independent of `@paykernel/testkit`.
 *
 * ⚠️ Do not use in production payment paths.
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
      const released: WebhookInboxRecord = {
        ...rec,
        status: "pending",
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
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
      if (existing) {
        const rec = releaseExpiredLease(input.key, existing);
        if (rec.payloadHash !== input.payloadHash) {
          return { kind: "payload_hash_conflict", record: rec };
        }
        if (rec.status === "completed") {
          return { kind: "already_completed", record: rec };
        }
        if (rec.status === "dead_letter" || rec.status === "failed") {
          return { kind: "duplicate_failed", record: rec };
        }
        if (rec.status === "claimed" && isLeaseActive(rec, clock)) {
          return { kind: "in_progress", record: rec };
        }
        // True backoff: pending with future availableAt must not reacquire.
        if (
          rec.status === "pending" &&
          Date.parse(rec.availableAt) > clock.nowMs()
        ) {
          return {
            kind: "not_available",
            record: rec,
            availableAt: rec.availableAt,
          };
        }
      }

      enforceCap(input.key);
      const generation = (existing?.generation ?? 0) + 1;
      const leaseToken = newLeaseToken(clock, generation);
      const now = iso(clock);
      // `existing` already passed the availableAt gate above (or is expired-claimed
      // soft-released to pending with availableAt=now). Re-read for lease release only.
      const base = existing ? releaseExpiredLease(input.key, existing) : undefined;
      if (base && base.payloadHash !== input.payloadHash) {
        return { kind: "payload_hash_conflict", record: base };
      }
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
