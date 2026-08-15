/**
 * NON-PRODUCTION / NON-DISTRIBUTED in-memory implementations of store contracts.
 *
 * ⚠️ Do not use in production payment paths.
 * - Single isolate only (process-local Maps).
 * - Atomicity = synchronous critical sections in this isolate, NOT multi-process.
 * - Crash / restart loses all state (no durability).
 * - Does not store raw provider payloads by default.
 */

import type { Clock } from "./fake-clock";
import { createFakeClock } from "./fake-clock";
import type {
  ClaimReconciliationInput,
  ClaimResult,
  ClaimWebhookInput,
  ClaimWebhookResult,
  CleanupInput,
  CleanupResult,
  CompleteIdempotencyInput,
  CompleteReconciliationInput,
  CompleteWebhookInput,
  FailReconciliationInput,
  FailWebhookInput,
  IdempotencyKey,
  IdempotencyRecord,
  IdempotencyReservation,
  IdempotencyStore,
  ListDueInput,
  ListRetryableInput,
  MarkIndeterminateInput,
  MarkManualReviewInput,
  ReconciliationKey,
  ReconciliationRecord,
  ReconciliationStore,
  RenewIdempotencyReservationInput,
  RenewReconciliationLeaseInput,
  RenewReconciliationLeaseResult,
  RenewReservationResult,
  RenewWebhookLeaseInput,
  RenewWebhookLeaseResult,
  ReserveIdempotencyInput,
  ScheduleReconciliationInput,
  ScheduleResult,
  WebhookEventKey,
  WebhookInboxRecord,
  WebhookInboxStore,
} from "../storage/contracts";
import {
  StoreLeaseLostError,
  StoreUnavailableError,
} from "../storage/contracts";
import type { StorageAdapterManifest } from "../storage/adapter-manifest";
import { MEMORY_STORAGE_ADAPTER_MANIFEST } from "../storage/adapter-manifest";

// ─── Public markers ──────────────────────────────────────────────────────────

/**
 * Banner for docs and runtime checks.
 * Memory stores always expose `NON_PRODUCTION: true` and `NON_DISTRIBUTED: true`.
 *
 * @remarks NON-PRODUCTION. Test-only. Not safe for multi-process or distributed use.
 */
export const NON_PRODUCTION = true as const;
export const NON_DISTRIBUTED = true as const;

/**
 * Human-readable banner for logs and docs.
 * @remarks NON-PRODUCTION. Test-only. Not safe for multi-process or distributed use.
 */
export const MEMORY_STORE_WARNING =
  "NON-PRODUCTION: in-memory store is for tests only" as const;

export type MemoryStoreCrashHook = {
  /**
   * When set, the next mutating operation throws before applying changes
   * (simulates crash mid-request). Cleared after one throw unless `sticky`.
   */
  failNextMutation?: boolean;
  sticky?: boolean;
  /** Optional message for the simulated crash. */
  message?: string;
};

export type MemoryStoreOptions = {
  clock?: Clock;
  /**
   * Crash-boundary simulation. Process exit is still the real crash model;
   * this only injects failures for tests.
   */
  crash?: MemoryStoreCrashHook;
  /**
   * Max entries before oldest-key eviction on write (default unbounded for tests).
   * Must not evict `reserved`/`claimed` rows with an active lease — skip those
   * victims or refuse the new write (fail-closed).
   */
  maxEntries?: number;
};

type InternalCrash = {
  failNextMutation: boolean;
  sticky: boolean;
  message: string;
};

function resolveCrash(opts?: MemoryStoreCrashHook): InternalCrash {
  return {
    failNextMutation: opts?.failNextMutation === true,
    sticky: opts?.sticky === true,
    message: opts?.message ?? "Simulated memory-store crash boundary",
  };
}

function newLeaseToken(clock: Clock, generation: number): string {
  // Opaque string; not a secret. Portable (no 64-bit number IDs).
  return `lease_${clock.nowMs()}_${generation}_${Math.random().toString(36).slice(2, 12)}`;
}

function iso(clock: Clock): string {
  return new Date(clock.nowMs()).toISOString();
}

function isLeaseActive(
  record: { leaseExpiresAt?: string | undefined },
  clock: Clock,
): boolean {
  if (!record.leaseExpiresAt) return false;
  return Date.parse(record.leaseExpiresAt) > clock.nowMs();
}

/**
 * Snapshot a Map of plain records for transaction rollback.
 * Uses structuredClone so nested result objects are not shared.
 */
function snapshotMap<K, V>(map: Map<K, V>): Map<K, V> {
  const out = new Map<K, V>();
  for (const [k, v] of map) {
    out.set(k, structuredClone(v));
  }
  return out;
}

function restoreMap<K, V>(target: Map<K, V>, snapshot: Map<K, V>): void {
  target.clear();
  for (const [k, v] of snapshot) {
    target.set(k, structuredClone(v));
  }
}

function isActiveClaimedOrReserved(
  rec: { status: string; leaseExpiresAt?: string | undefined },
  clock: Clock,
): boolean {
  return (rec.status === "claimed" || rec.status === "reserved") && isLeaseActive(rec, clock);
}

function enforceMaxEntries<K, V>(
  entries: Map<K, V>,
  maxEntries: number | undefined,
  newKey: K,
  isProtected: (rec: V) => boolean,
): void {
  if (maxEntries === undefined) return;
  if (entries.has(newKey)) return;
  while (entries.size >= maxEntries) {
    let victim: K | undefined;
    for (const [key, rec] of entries) {
      if (isProtected(rec)) continue;
      victim = key;
      break;
    }
    if (victim === undefined) {
      throw new StoreUnavailableError(
        "memory store at capacity: refusing to evict claimed/reserved row with active lease",
      );
    }
    entries.delete(victim);
  }
}

/**
 * Crash boundary for memory stores (process model):
 * - Real crash / restart: entire Map is gone (ephemeral).
 * - Simulated crash via `simulateCrash()`: next mutation throws before apply.
 * - Worker abandon: acquire lease then never complete/renew; after lease expiry
 *   another worker may reclaim with a new token. Old token is rejected.
 * - NOT multi-process safe: do not treat Map mutations as distributed locks.
 */

// ─── Idempotency ─────────────────────────────────────────────────────────────

export type MemoryIdempotencyStore = IdempotencyStore & {
  readonly NON_PRODUCTION: true;
  readonly NON_DISTRIBUTED: true;
  readonly MEMORY_STORE_WARNING: typeof MEMORY_STORE_WARNING;
  /**
   * Test helper: arm next mutation to throw (crash mid-request).
   * Real process crash = abandon lease without complete; reclaim after expiry.
   */
  simulateCrash(options?: { sticky?: boolean; message?: string }): void;
  /** Clear all entries (test isolation). */
  clear(): void;
  readonly size: number;
  /**
   * Clone-on-enter transaction: restores Map on throw.
   * Async callbacks are allowed here (in-memory only). SQL adapters must not
   * await external I/O inside a synchronous engine transaction.
   */
  withTransaction<T>(fn: () => Promise<T> | T): Promise<T>;
};

export function createMemoryIdempotencyStore(
  options: MemoryStoreOptions = {},
): MemoryIdempotencyStore {
  const clock = options.clock ?? createFakeClock();
  const maxEntries = options.maxEntries;
  const entries = new Map<IdempotencyKey, IdempotencyRecord>();
  let crash = resolveCrash(options.crash);

  function maybeCrash(): void {
    if (!crash.failNextMutation) return;
    if (!crash.sticky) {
      crash = { ...crash, failNextMutation: false };
    }
    throw new StoreUnavailableError(crash.message);
  }

  function expireIfNeeded(key: IdempotencyKey, rec: IdempotencyRecord): IdempotencyRecord {
    if (
      rec.status === "reserved" &&
      rec.leaseExpiresAt &&
      Date.parse(rec.leaseExpiresAt) <= clock.nowMs()
    ) {
      const expired: IdempotencyRecord = {
        ...rec,
        status: "expired",
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: iso(clock),
      };
      entries.set(key, expired);
      return expired;
    }
    return rec;
  }

  function enforceCap(newKey: IdempotencyKey): void {
    enforceMaxEntries(entries, maxEntries, newKey, (rec) =>
      isActiveClaimedOrReserved(rec, clock),
    );
  }

  const store: MemoryIdempotencyStore = {
    NON_PRODUCTION: true,
    NON_DISTRIBUTED: true,
    MEMORY_STORE_WARNING,

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
      const snap = snapshotMap(entries);
      try {
        return await fn();
      } catch (err) {
        restoreMap(entries, snap);
        throw err;
      }
    },

    async reserve(input: ReserveIdempotencyInput): Promise<IdempotencyReservation> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (existing) {
        const rec = expireIfNeeded(input.key, existing);
        // Terminal / A4 before fingerprint so completed+indeterminate re-use
        // with a different digest still ACKs (does not look like a conflict).
        if (rec.status === "completed") {
          return { kind: "already_completed", record: rec };
        }
        if (rec.status === "indeterminate") {
          return { kind: "indeterminate", record: rec };
        }
        if (rec.fingerprint !== input.fingerprint) {
          return { kind: "fingerprint_conflict", record: rec };
        }
        if (rec.status === "reserved" && isLeaseActive(rec, clock)) {
          return { kind: "in_progress", record: rec };
        }
        // expired or free to re-reserve
      }

      enforceCap(input.key);
      const generation = (existing?.generation ?? 0) + 1;
      const leaseToken = newLeaseToken(clock, generation);
      const now = iso(clock);
      const record: IdempotencyRecord = {
        key: input.key,
        status: "reserved",
        fingerprint: input.fingerprint,
        leaseOwner: input.owner,
        leaseToken,
        leaseExpiresAt: new Date(clock.nowMs() + input.leaseMs).toISOString(),
        attempts: (existing?.attempts ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        generation,
      };
      entries.set(input.key, record);
      return { kind: "acquired", record, leaseToken };
    },

    async renew(input: RenewIdempotencyReservationInput): Promise<RenewReservationResult> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (!existing) return { ok: false, reason: "not_found" };
      const rec = expireIfNeeded(input.key, existing);
      if (rec.status !== "reserved") return { ok: false, reason: "wrong_status" };
      if (rec.leaseToken !== input.leaseToken || !isLeaseActive(rec, clock)) {
        return { ok: false, reason: "lease_lost" };
      }
      const generation = rec.generation + 1;
      const leaseToken = newLeaseToken(clock, generation);
      const updated: IdempotencyRecord = {
        ...rec,
        leaseToken,
        leaseExpiresAt: new Date(clock.nowMs() + input.leaseMs).toISOString(),
        generation,
        updatedAt: iso(clock),
      };
      entries.set(input.key, updated);
      return { ok: true, record: updated, leaseToken };
    },

    async complete(input: CompleteIdempotencyInput): Promise<void> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (!existing) throw new StoreLeaseLostError("complete: key not found");
      const rec = expireIfNeeded(input.key, existing);
      if (rec.status !== "reserved" || rec.leaseToken !== input.leaseToken) {
        throw new StoreLeaseLostError("complete: lease token rejected");
      }
      if (!isLeaseActive(rec, clock)) {
        throw new StoreLeaseLostError("complete: lease expired");
      }
      const updated: IdempotencyRecord = {
        ...rec,
        status: "completed",
        result: input.result,
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: iso(clock),
      };
      entries.set(input.key, updated);
    },

    async markIndeterminate(input: MarkIndeterminateInput): Promise<void> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (!existing) throw new StoreLeaseLostError("markIndeterminate: key not found");
      const rec = expireIfNeeded(input.key, existing);
      if (rec.status !== "reserved" || rec.leaseToken !== input.leaseToken) {
        throw new StoreLeaseLostError("markIndeterminate: lease token rejected");
      }
      const updated: IdempotencyRecord = {
        ...rec,
        status: "indeterminate",
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: iso(clock),
        // TESTKIT-2: never store free-form `reason` (may carry PII/tokens).
        // Status alone fences reserve; keep prior result if any.
        result: rec.result,
      };
      entries.set(input.key, updated);
    },

    async get(key: IdempotencyKey): Promise<IdempotencyRecord | undefined> {
      const existing = entries.get(key);
      if (!existing) return undefined;
      return expireIfNeeded(key, existing);
    },

    async deleteExpired(input: CleanupInput): Promise<CleanupResult> {
      maybeCrash();
      const before = Date.parse(input.before);
      let deleted = 0;
      const limit = input.limit ?? Number.POSITIVE_INFINITY;
      for (const [key, rec] of entries) {
        if (deleted >= limit) break;
        // Terminal-only retention (SQL/Redis parity). Soft-release / reclaim of
        // reserved rows is separate from deleteExpired — never wipe reclaimable
        // reserved keys just because leaseExpiresAt <= before (A4 hygiene).
        // Also never delete indeterminate by default.
        if (rec.status !== "completed" && rec.status !== "expired") continue;
        if (Date.parse(rec.updatedAt) > before) continue;
        entries.delete(key);
        deleted++;
      }
      return { deleted };
    },
  };

  return store;
}

// ─── Webhook inbox ───────────────────────────────────────────────────────────

export type MemoryWebhookInboxStore = WebhookInboxStore & {
  readonly NON_PRODUCTION: true;
  readonly NON_DISTRIBUTED: true;
  readonly MEMORY_STORE_WARNING: typeof MEMORY_STORE_WARNING;
  simulateCrash(options?: { sticky?: boolean; message?: string }): void;
  clear(): void;
  readonly size: number;
  withTransaction<T>(fn: () => Promise<T> | T): Promise<T>;
};

export function createMemoryWebhookInboxStore(
  options: MemoryStoreOptions = {},
): MemoryWebhookInboxStore {
  const clock = options.clock ?? createFakeClock();
  const maxEntries = options.maxEntries;
  const entries = new Map<WebhookEventKey, WebhookInboxRecord>();
  let crash = resolveCrash(options.crash);

  function maybeCrash(): void {
    if (!crash.failNextMutation) return;
    if (!crash.sticky) {
      crash = { ...crash, failNextMutation: false };
    }
    throw new StoreUnavailableError(crash.message);
  }

  function releaseExpiredLease(key: WebhookEventKey, rec: WebhookInboxRecord): WebhookInboxRecord {
    if (
      rec.status === "claimed" &&
      rec.leaseExpiresAt &&
      Date.parse(rec.leaseExpiresAt) <= clock.nowMs()
    ) {
      // WEBHOOKS-1: restore unfinished claim attempt so crash reclaim does not
      // burn maxAttempts handler budget (parity with @paykernel/webhooks memory).
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
    enforceMaxEntries(entries, maxEntries, newKey, (rec) =>
      isActiveClaimedOrReserved(rec, clock),
    );
  }

  const store: MemoryWebhookInboxStore = {
    NON_PRODUCTION: true,
    NON_DISTRIBUTED: true,
    MEMORY_STORE_WARNING,

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
      const snap = snapshotMap(entries);
      try {
        return await fn();
      } catch (err) {
        restoreMap(entries, snap);
        throw err;
      }
    },

    async claim(input: ClaimWebhookInput): Promise<ClaimWebhookResult> {
      maybeCrash();
      const existing = entries.get(input.key);
      if (existing) {
        const rec = releaseExpiredLease(input.key, existing);
        if (rec.status === "completed") {
          return { kind: "already_completed", record: rec };
        }
        if (rec.status === "dead_letter" || rec.status === "failed") {
          return { kind: "duplicate_failed", record: rec };
        }
        if (rec.status === "claimed" && isLeaseActive(rec, clock)) {
          if (rec.payloadHash !== input.payloadHash) {
            return { kind: "payload_hash_conflict", record: rec };
          }
          return { kind: "in_progress", record: rec };
        }
        // Same-hash backoff only; idle hash mismatch supersedes (WEBHOOKS-3).
        if (
          rec.payloadHash === input.payloadHash &&
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
      const base = existing ? releaseExpiredLease(input.key, existing) : undefined;
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
      // WEBHOOKS-2: accept fail with matching token even after lease expiry.
      // Soft-release-first would clear the token + restore attempts, making
      // maxAttempts a no-op for hang/timeout handlers that still call fail.
      // Crash reclaim (get/listRetryable) still soft-restores unfinished claims.
      if (
        existing.status !== "claimed" ||
        existing.leaseToken !== input.leaseToken
      ) {
        throw new StoreLeaseLostError("fail: lease token rejected");
      }
      const retryAfterMs = input.retryAfterMs ?? 0;
      const dead = input.deadLetter === true;
      const attempts =
        input.restoreAttempt === true
          ? Math.max(0, existing.attempts - 1)
          : existing.attempts;
      entries.set(input.key, {
        ...existing,
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

// ─── Reconciliation ──────────────────────────────────────────────────────────

export type MemoryReconciliationStore = ReconciliationStore & {
  readonly NON_PRODUCTION: true;
  readonly NON_DISTRIBUTED: true;
  readonly MEMORY_STORE_WARNING: typeof MEMORY_STORE_WARNING;
  simulateCrash(options?: { sticky?: boolean; message?: string }): void;
  clear(): void;
  readonly size: number;
  withTransaction<T>(fn: () => Promise<T> | T): Promise<T>;
  listTerminal(input?: { limit?: number }): Promise<ReconciliationRecord[]>;
};

export function createMemoryReconciliationStore(
  options: MemoryStoreOptions = {},
): MemoryReconciliationStore {
  const clock = options.clock ?? createFakeClock();
  const maxEntries = options.maxEntries;
  const entries = new Map<ReconciliationKey, ReconciliationRecord>();
  let crash = resolveCrash(options.crash);

  function maybeCrash(): void {
    if (!crash.failNextMutation) return;
    if (!crash.sticky) {
      crash = { ...crash, failNextMutation: false };
    }
    throw new StoreUnavailableError(crash.message);
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
    enforceMaxEntries(entries, maxEntries, newKey, (rec) =>
      isActiveClaimedOrReserved(rec, clock),
    );
  }

  const store: MemoryReconciliationStore = {
    NON_PRODUCTION: true,
    NON_DISTRIBUTED: true,
    MEMORY_STORE_WARNING,

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
      const snap = snapshotMap(entries);
      try {
        return await fn();
      } catch (err) {
        restoreMap(entries, snap);
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
      const rec = releaseExpiredLease(input.key, existing);
      if (rec.status !== "claimed" || rec.leaseToken !== input.leaseToken) {
        throw new StoreLeaseLostError("fail: lease token rejected");
      }
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
      if (!existing) throw new StoreLeaseLostError("markManualReview: key not found");
      const rec = releaseExpiredLease(input.key, existing);
      if (rec.status !== "claimed" || rec.leaseToken !== input.leaseToken) {
        throw new StoreLeaseLostError("markManualReview: lease token rejected");
      }
      entries.set(input.key, {
        ...rec,
        status: "manual_review",
        lastError: input.note,
        leaseToken: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: iso(clock),
      });
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

// ─── Bundle factory ──────────────────────────────────────────────────────────

export type MemoryStores = {
  readonly NON_PRODUCTION: true;
  readonly NON_DISTRIBUTED: true;
  idempotency: MemoryIdempotencyStore;
  webhookInbox: MemoryWebhookInboxStore;
  reconciliation: MemoryReconciliationStore;
  /**
   * Machine-readable guarantees for this multi-store (single-process, ephemeral).
   * Always {@link MEMORY_STORAGE_ADAPTER_MANIFEST}.
   */
  manifest: StorageAdapterManifest;
  clock: Clock;
};

/**
 * Create all three NON-PRODUCTION memory stores sharing one clock.
 * Bundle includes {@link MEMORY_STORAGE_ADAPTER_MANIFEST} for discoverability.
 */
export function createMemoryStores(options: MemoryStoreOptions = {}): MemoryStores {
  const clock = options.clock ?? createFakeClock();
  const shared: MemoryStoreOptions = { ...options, clock };
  return {
    NON_PRODUCTION: true,
    NON_DISTRIBUTED: true,
    idempotency: createMemoryIdempotencyStore(shared),
    webhookInbox: createMemoryWebhookInboxStore(shared),
    reconciliation: createMemoryReconciliationStore(shared),
    manifest: MEMORY_STORAGE_ADAPTER_MANIFEST,
    clock,
  };
}
