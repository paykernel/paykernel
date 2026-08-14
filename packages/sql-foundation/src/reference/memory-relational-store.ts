/**
 * In-process memory-relational reference applying claim algorithms under a mutex.
 *
 * NON-PRODUCTION / NON-DISTRIBUTED. Used for unit tests and same-isolate contention
 * proofs of the pure claim algorithm. Not a durable adapter.
 *
 * Multi-connection claim proofs for real engines are Phase 12+ adapter tests;
 * this reference serializes concurrent async callers via a promise chain mutex
 * so "one winner" behavior matches engine-level atomic claim intent.
 */

import {
  decideIdempotencyReserve,
  decideLeaseMutation,
  decideReconciliationClaim,
  decideWebhookClaim,
  type IdempotencyExistingSnapshot,
  type ReconciliationExistingSnapshot,
  type WebhookExistingSnapshot,
} from "../claims/algorithm";
import type {
  IdempotencyRecordShape,
  ReconciliationRecordShape,
  WebhookInboxRecordShape,
} from "../codecs/rows";
import {
  idempotencyRecordToRow,
  idempotencyRowToRecord,
  reconciliationRecordToRow,
  reconciliationRowToRecord,
  webhookInboxRecordToRow,
  webhookInboxRowToRecord,
} from "../codecs/rows";
import { enforceMaxSanitizedError } from "../codecs/validation";
import type { DialectId } from "../claims/dialect";
import {
  createSchemaNamespace,
  resolveUnqualifiedTableName,
  type ResolvedSchemaNamespace,
  type SchemaNamespaceConfig,
} from "../schema/namespace";
import { ALL_LOGICAL_TABLES, LOGICAL_TABLES } from "../schema/tables";
import { migrate, type SqlExecutor } from "../migrations/migrate";
import { verifySchema } from "../migrations/verify";

export const MEMORY_RELATIONAL_NON_PRODUCTION = true as const;
export const MEMORY_RELATIONAL_NON_DISTRIBUTED = true as const;

/**
 * Fencing rejection for stale/wrong/expired lease tokens on mutators.
 * Mirrors testkit `StoreLeaseLostError` by code without importing testkit.
 */
export class ReferenceLeaseLostError extends Error {
  readonly code = "lease_lost" as const;
  constructor(message = "Lease lost or fencing token rejected") {
    super(message);
    this.name = "ReferenceLeaseLostError";
  }
}

export function isReferenceLeaseLostError(error: unknown): boolean {
  return (
    error instanceof ReferenceLeaseLostError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "lease_lost")
  );
}

export type MemoryRelationalOptions = {
  namespace?: SchemaNamespaceConfig;
  /** Starting clock ms (default Date.now()). */
  nowMs?: number;
};

function newLeaseToken(nowMs: number, generation: number): string {
  return `lease_${nowMs}_${generation}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Promise-chain mutex: serializes async critical sections in one isolate.
 * Proves claim contention chooses one winner when many callers race.
 */
function createMutex() {
  let tail: Promise<void> = Promise.resolve();
  return function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export type MemoryRelationalStore = {
  readonly NON_PRODUCTION: true;
  readonly NON_DISTRIBUTED: true;
  readonly namespace: ResolvedSchemaNamespace;
  /** Advance fake clock. */
  setNowMs(ms: number): void;
  nowMs(): number;
  /** List physical table names (after "migrate"). */
  listTables(): string[];
  /** Explicit migrate using internal fake executor. */
  migrate(dialect?: DialectId): Promise<{ applied: readonly number[]; currentVersion: number }>;
  verify(
    dialect?: DialectId,
  ): Promise<{ ok: boolean; missing: readonly string[]; version: number }>;
  /** Fake executor for migrate/verify tests. */
  createExecutor(): SqlExecutor;

  reserveIdempotency(input: {
    key: string;
    fingerprint: string;
    owner: string;
    leaseMs: number;
  }): Promise<
    | { kind: "acquired"; record: IdempotencyRecordShape; leaseToken: string }
    | { kind: "already_completed"; record: IdempotencyRecordShape }
    | { kind: "in_progress"; record: IdempotencyRecordShape }
    | { kind: "indeterminate"; record: IdempotencyRecordShape }
    | { kind: "fingerprint_conflict"; record: IdempotencyRecordShape }
  >;

  claimWebhook(input: {
    key: string;
    payloadHash: string;
    owner: string;
    leaseMs: number;
    payloadRef?: string;
  }): Promise<
    | { kind: "acquired"; record: WebhookInboxRecordShape; leaseToken: string }
    | { kind: "already_completed"; record: WebhookInboxRecordShape }
    | { kind: "in_progress"; record: WebhookInboxRecordShape }
    | { kind: "not_available"; record: WebhookInboxRecordShape; availableAt: string }
    | { kind: "payload_hash_conflict"; record: WebhookInboxRecordShape }
    | { kind: "duplicate_failed"; record: WebhookInboxRecordShape }
  >;

  scheduleReconciliation(input: {
    key: string;
    subjectId: string;
    reason: string;
    dueAt: string;
  }): Promise<
    | { kind: "scheduled"; record: ReconciliationRecordShape }
    | { kind: "already_exists"; record: ReconciliationRecordShape }
  >;

  claimReconciliation(input: {
    key: string;
    owner: string;
    leaseMs: number;
  }): Promise<
    | { kind: "acquired"; record: ReconciliationRecordShape; leaseToken: string }
    | { kind: "not_found" }
    | { kind: "not_due"; record: ReconciliationRecordShape }
    | { kind: "in_progress"; record: ReconciliationRecordShape }
    | { kind: "already_terminal"; record: ReconciliationRecordShape }
  >;

  /**
   * Complete idempotency reservation. Requires active leaseToken.
   * Stale/wrong/expired → {@link ReferenceLeaseLostError}.
   */
  completeIdempotency(input: { key: string; leaseToken: string; result: unknown }): Promise<void>;

  /**
   * Mark indeterminate (A4). Requires active leaseToken.
   * Stale → {@link ReferenceLeaseLostError}.
   */
  markIdempotencyIndeterminate(input: {
    key: string;
    leaseToken: string;
    reason?: string;
  }): Promise<void>;

  /**
   * Complete webhook claim. Requires active leaseToken.
   * Stale → {@link ReferenceLeaseLostError}.
   */
  completeWebhook(input: { key: string; leaseToken: string }): Promise<void>;

  /**
   * Fail webhook claim. Matching leaseToken on claimed is enough
   * (WEBHOOKS-2: succeeds after lease expiry). Stale/wrong token →
   * {@link ReferenceLeaseLostError}.
   */
  failWebhook(input: {
    key: string;
    leaseToken: string;
    error: string;
    deadLetter?: boolean;
    retryAfterMs?: number;
    /** When true, decrement attempts by 1 (parking claim restore). */
    restoreAttempt?: boolean;
  }): Promise<void>;

  /**
   * Complete reconciliation claim. Requires active leaseToken.
   * Stale → {@link ReferenceLeaseLostError}.
   */
  completeReconciliation(input: { key: string; leaseToken: string }): Promise<void>;

  /**
   * Fail reconciliation claim. Requires active leaseToken.
   * Stale → {@link ReferenceLeaseLostError}.
   */
  failReconciliation(input: { key: string; leaseToken: string; error: string }): Promise<void>;

  getIdempotency(key: string): IdempotencyRecordShape | undefined;
  getWebhook(key: string): WebhookInboxRecordShape | undefined;
  getReconciliation(key: string): ReconciliationRecordShape | undefined;

  /** Test helper: clear all rows (tables remain). */
  clearRows(): void;

  /**
   * Atomicity model for docs/tests: same-isolate promise-chain mutex.
   * Not multi-host / multi-connection. Phase 12 SQL adapters must use
   * engine-level single conditional write instead.
   */
  readonly atomicityModel: "process_local_mutex";
};

/**
 * Create in-process relational reference store.
 * Does **not** auto-migrate; call `migrate()` explicitly.
 */
export function createMemoryRelationalStore(
  options: MemoryRelationalOptions = {},
): MemoryRelationalStore {
  const namespace = createSchemaNamespace(options.namespace ?? {});
  let clockMs = options.nowMs ?? Date.now();
  const withLock = createMutex();

  const tables = new Set<string>();
  const migrations = new Map<number, { name: string; appliedAt: string; checksum?: string }>();
  const idempotency = new Map<string, IdempotencyRecordShape>();
  const webhooks = new Map<string, WebhookInboxRecordShape>();
  const reconciliation = new Map<string, ReconciliationRecordShape>();

  const physical = {
    idempotency: resolveUnqualifiedTableName(LOGICAL_TABLES.idempotency, namespace),
    webhookInbox: resolveUnqualifiedTableName(LOGICAL_TABLES.webhookInbox, namespace),
    reconciliationJobs: resolveUnqualifiedTableName(LOGICAL_TABLES.reconciliationJobs, namespace),
    storageMigrations: resolveUnqualifiedTableName(LOGICAL_TABLES.storageMigrations, namespace),
  };

  function createExecutor(): SqlExecutor {
    return {
      execute(sql: string, params?: readonly unknown[]) {
        const s = sql.trim();
        // CREATE TABLE IF NOT EXISTS "name"
        const createMatch = s.match(
          /CREATE TABLE IF NOT EXISTS\s+(?:"([^"]+)"(?:\."([^"]+)")?|([A-Za-z_][A-Za-z0-9_]*))/i,
        );
        if (createMatch) {
          const name = createMatch[2] ?? createMatch[1] ?? createMatch[3] ?? "";
          if (name) tables.add(name);
          return { ok: true };
        }
        if (/CREATE INDEX IF NOT EXISTS/i.test(s)) {
          return { ok: true };
        }
        // INSERT into migrations
        if (/INSERT INTO/i.test(s) && /version/i.test(s) && params && params.length >= 3) {
          const version = Number(params[0]);
          const name = String(params[1]);
          const appliedAt = String(params[2]);
          const checksum =
            params[3] !== undefined && params[3] !== null ? String(params[3]) : undefined;
          tables.add(physical.storageMigrations);
          const row: { name: string; appliedAt: string; checksum?: string } = {
            name,
            appliedAt,
          };
          if (checksum !== undefined) row.checksum = checksum;
          migrations.set(version, row);
          return { ok: true };
        }
        return { ok: true };
      },
      query<T = Record<string, unknown>>(sql: string) {
        if (/SELECT version FROM/i.test(sql)) {
          const rows = [...migrations.entries()]
            .sort((a, b) => b[0] - a[0])
            .map(([version, meta]) => ({
              version,
              name: meta.name,
              applied_at: meta.appliedAt,
              checksum: meta.checksum ?? null,
            }));
          return rows as T[];
        }
        if (/sqlite_master/i.test(sql) || /information_schema/i.test(sql)) {
          return [...tables].map((name) => ({ name, table_name: name })) as T[];
        }
        return [] as T[];
      },
    };
  }

  const store: MemoryRelationalStore = {
    NON_PRODUCTION: true,
    NON_DISTRIBUTED: true,
    namespace,
    atomicityModel: "process_local_mutex",

    setNowMs(ms: number) {
      clockMs = ms;
    },
    nowMs() {
      return clockMs;
    },
    listTables() {
      return [...tables];
    },
    createExecutor,

    async migrate(dialect: DialectId = "sqlite") {
      // Register expected tables eagerly via migrate path
      const exec = createExecutor();
      const result = await migrate(exec, { dialect, namespace });
      for (const logical of ALL_LOGICAL_TABLES) {
        tables.add(resolveUnqualifiedTableName(logical, namespace));
      }
      return {
        applied: result.applied,
        currentVersion: result.currentVersion,
      };
    },

    async verify(dialect: DialectId = "sqlite") {
      const exec = createExecutor();
      const result = await verifySchema(exec, {
        dialect,
        namespace,
        listTables: () => [...tables],
      });
      return {
        ok: result.ok,
        missing: result.missing,
        version: result.version,
      };
    },

    clearRows() {
      idempotency.clear();
      webhooks.clear();
      reconciliation.clear();
    },

    async reserveIdempotency(input) {
      return withLock(() => {
        const existingRec = idempotency.get(input.key);
        let existing: IdempotencyExistingSnapshot | undefined;
        if (existingRec) {
          existing = {
            status: existingRec.status,
            fingerprint: existingRec.fingerprint,
            leaseExpiresAt: existingRec.leaseExpiresAt,
            generation: existingRec.generation,
            attempts: existingRec.attempts,
            createdAt: existingRec.createdAt,
            result: existingRec.result,
          };
        }
        const token = newLeaseToken(clockMs, (existingRec?.generation ?? 0) + 1);
        const decision = decideIdempotencyReserve({
          key: input.key,
          fingerprint: input.fingerprint,
          owner: input.owner,
          leaseMs: input.leaseMs,
          newLeaseToken: token,
          clock: { nowMs: clockMs },
          existing,
        });

        if (decision.kind !== "acquired") {
          const record = existingRec!;
          return { kind: decision.kind, record };
        }

        const record: IdempotencyRecordShape = {
          key: input.key,
          status: "reserved",
          fingerprint: decision.fingerprint,
          leaseOwner: decision.leaseOwner,
          leaseToken: decision.leaseToken,
          leaseExpiresAt: decision.leaseExpiresAt,
          attempts: decision.attempts,
          createdAt: decision.createdAt,
          updatedAt: decision.updatedAt,
          generation: decision.generation,
        };
        // Round-trip through codec to enforce validation
        const normalized = idempotencyRowToRecord(idempotencyRecordToRow(record));
        idempotency.set(input.key, normalized);
        return {
          kind: "acquired" as const,
          record: normalized,
          leaseToken: decision.leaseToken,
        };
      });
    },

    async claimWebhook(input) {
      return withLock(() => {
        const existingRec = webhooks.get(input.key);
        let existing: WebhookExistingSnapshot | undefined;
        if (existingRec) {
          existing = {
            status: existingRec.status,
            payloadHash: existingRec.payloadHash,
            leaseExpiresAt: existingRec.leaseExpiresAt,
            generation: existingRec.generation,
            attempts: existingRec.attempts,
            createdAt: existingRec.createdAt,
            availableAt: existingRec.availableAt,
            payloadRef: existingRec.payloadRef,
          };
        }
        const token = newLeaseToken(clockMs, (existingRec?.generation ?? 0) + 1);
        const decision = decideWebhookClaim({
          key: input.key,
          payloadHash: input.payloadHash,
          owner: input.owner,
          leaseMs: input.leaseMs,
          newLeaseToken: token,
          clock: { nowMs: clockMs },
          payloadRef: input.payloadRef,
          existing,
        });

        if (decision.kind !== "acquired") {
          // Narrow by kind so exactOptionalPropertyTypes / union assignability stays sound.
          switch (decision.kind) {
            case "already_completed":
              return { kind: "already_completed", record: existingRec! };
            case "in_progress":
              return { kind: "in_progress", record: existingRec! };
            case "not_available":
              return {
                kind: "not_available",
                record: existingRec!,
                availableAt: existingRec!.availableAt,
              };
            case "payload_hash_conflict":
              return { kind: "payload_hash_conflict", record: existingRec! };
            case "duplicate_failed":
              return { kind: "duplicate_failed", record: existingRec! };
            default: {
              const _exhaustive: never = decision;
              return _exhaustive;
            }
          }
        }

        const record: WebhookInboxRecordShape = {
          key: input.key,
          status: "claimed",
          payloadHash: decision.payloadHash,
          leaseOwner: decision.leaseOwner,
          leaseToken: decision.leaseToken,
          leaseExpiresAt: decision.leaseExpiresAt,
          attempts: decision.attempts,
          createdAt: decision.createdAt,
          updatedAt: decision.updatedAt,
          availableAt: decision.availableAt,
          generation: decision.generation,
        };
        if (decision.payloadRef !== undefined) {
          record.payloadRef = decision.payloadRef;
        }
        const normalized = webhookInboxRowToRecord(webhookInboxRecordToRow(record));
        webhooks.set(input.key, normalized);
        return {
          kind: "acquired" as const,
          record: normalized,
          leaseToken: decision.leaseToken,
        };
      });
    },

    async scheduleReconciliation(input) {
      return withLock(() => {
        const existing = reconciliation.get(input.key);
        if (existing) {
          return { kind: "already_exists" as const, record: existing };
        }
        const now = new Date(clockMs).toISOString();
        const record: ReconciliationRecordShape = {
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
        const normalized = reconciliationRowToRecord(reconciliationRecordToRow(record));
        reconciliation.set(input.key, normalized);
        return { kind: "scheduled" as const, record: normalized };
      });
    },

    async claimReconciliation(input) {
      return withLock(() => {
        const existingRec = reconciliation.get(input.key);
        let existing: ReconciliationExistingSnapshot | undefined;
        if (existingRec) {
          existing = {
            status: existingRec.status,
            leaseExpiresAt: existingRec.leaseExpiresAt,
            generation: existingRec.generation,
            attempts: existingRec.attempts,
            dueAt: existingRec.dueAt,
            createdAt: existingRec.createdAt,
            subjectId: existingRec.subjectId,
            reason: existingRec.reason,
          };
        }
        const token = newLeaseToken(clockMs, (existingRec?.generation ?? 0) + 1);
        const decision = decideReconciliationClaim({
          key: input.key,
          owner: input.owner,
          leaseMs: input.leaseMs,
          newLeaseToken: token,
          clock: { nowMs: clockMs },
          existing,
        });

        if (decision.kind === "not_found") {
          return { kind: "not_found" as const };
        }
        if (decision.kind !== "acquired") {
          return { kind: decision.kind, record: existingRec! };
        }

        const record: ReconciliationRecordShape = {
          ...existingRec!,
          status: "claimed",
          leaseOwner: decision.leaseOwner,
          leaseToken: decision.leaseToken,
          leaseExpiresAt: decision.leaseExpiresAt,
          attempts: decision.attempts,
          generation: decision.generation,
          updatedAt: decision.updatedAt,
        };
        const normalized = reconciliationRowToRecord(reconciliationRecordToRow(record));
        reconciliation.set(input.key, normalized);
        return {
          kind: "acquired" as const,
          record: normalized,
          leaseToken: decision.leaseToken,
        };
      });
    },

    async completeIdempotency(input) {
      return withLock(() => {
        const existing = idempotency.get(input.key);
        const decision = decideLeaseMutation({
          exists: existing !== undefined,
          status: existing?.status ?? "",
          expectedStatus: "reserved",
          recordToken: existing?.leaseToken,
          providedToken: input.leaseToken,
          leaseExpiresAt: existing?.leaseExpiresAt,
          nowMs: clockMs,
        });
        if (!decision.ok) {
          throw new ReferenceLeaseLostError(`completeIdempotency: ${decision.reason}`);
        }
        const now = new Date(clockMs).toISOString();
        const record: IdempotencyRecordShape = {
          ...existing!,
          status: "completed",
          result: input.result,
          leaseOwner: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
          completedAt: now,
        };
        const normalized = idempotencyRowToRecord(idempotencyRecordToRow(record));
        idempotency.set(input.key, normalized);
      });
    },

    async markIdempotencyIndeterminate(input) {
      return withLock(() => {
        const existing = idempotency.get(input.key);
        const decision = decideLeaseMutation({
          exists: existing !== undefined,
          status: existing?.status ?? "",
          expectedStatus: "reserved",
          recordToken: existing?.leaseToken,
          providedToken: input.leaseToken,
          leaseExpiresAt: existing?.leaseExpiresAt,
          nowMs: clockMs,
          // markIndeterminate: testkit memory allows even if lease expired
          // when token matches reserved status? Memory store checks isLeaseActive
          // only for complete path via expireIfNeeded — actually markIndeterminate
          // in memory-stores does NOT check isLeaseActive, only token+status.
          // Keep requireActiveLease false for parity with "token match" fencing
          // when lease may have just expired during processing.
          requireActiveLease: false,
        });
        if (!decision.ok) {
          throw new ReferenceLeaseLostError(`markIdempotencyIndeterminate: ${decision.reason}`);
        }
        const now = new Date(clockMs).toISOString();
        const record: IdempotencyRecordShape = {
          ...existing!,
          status: "indeterminate",
          leaseOwner: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
          indeterminateAt: now,
          result: input.reason !== undefined ? { reason: input.reason } : existing!.result,
        };
        const normalized = idempotencyRowToRecord(idempotencyRecordToRow(record));
        idempotency.set(input.key, normalized);
      });
    },

    async completeWebhook(input) {
      return withLock(() => {
        const existing = webhooks.get(input.key);
        const decision = decideLeaseMutation({
          exists: existing !== undefined,
          status: existing?.status ?? "",
          expectedStatus: "claimed",
          recordToken: existing?.leaseToken,
          providedToken: input.leaseToken,
          leaseExpiresAt: existing?.leaseExpiresAt,
          nowMs: clockMs,
        });
        if (!decision.ok) {
          throw new ReferenceLeaseLostError(`completeWebhook: ${decision.reason}`);
        }
        const now = new Date(clockMs).toISOString();
        const record: WebhookInboxRecordShape = {
          ...existing!,
          status: "completed",
          leaseOwner: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
          completedAt: now,
        };
        const normalized = webhookInboxRowToRecord(webhookInboxRecordToRow(record));
        webhooks.set(input.key, normalized);
      });
    },

    async failWebhook(input) {
      return withLock(() => {
        const existing = webhooks.get(input.key);
        const decision = decideLeaseMutation({
          exists: existing !== undefined,
          status: existing?.status ?? "",
          expectedStatus: "claimed",
          recordToken: existing?.leaseToken,
          providedToken: input.leaseToken,
          leaseExpiresAt: existing?.leaseExpiresAt,
          nowMs: clockMs,
          // WEBHOOKS-2: hang/timeout handlers must still record fail after expiry.
          requireActiveLease: false,
        });
        if (!decision.ok) {
          throw new ReferenceLeaseLostError(`failWebhook: ${decision.reason}`);
        }
        const now = new Date(clockMs).toISOString();
        const dead = input.deadLetter === true;
        const retryAfterMs = input.retryAfterMs ?? 0;
        const availableAt = new Date(clockMs + retryAfterMs).toISOString();
        const lastError = enforceMaxSanitizedError(input.error);
        const attempts =
          input.restoreAttempt === true
            ? Math.max(0, existing!.attempts - 1)
            : existing!.attempts;
        const record: WebhookInboxRecordShape = {
          ...existing!,
          status: dead ? "dead_letter" : "pending",
          leaseOwner: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          attempts,
          updatedAt: now,
          availableAt,
        };
        if (lastError !== undefined) {
          record.lastError = lastError;
        }
        const normalized = webhookInboxRowToRecord(webhookInboxRecordToRow(record));
        webhooks.set(input.key, normalized);
      });
    },

    async completeReconciliation(input) {
      return withLock(() => {
        const existing = reconciliation.get(input.key);
        const decision = decideLeaseMutation({
          exists: existing !== undefined,
          status: existing?.status ?? "",
          expectedStatus: "claimed",
          recordToken: existing?.leaseToken,
          providedToken: input.leaseToken,
          leaseExpiresAt: existing?.leaseExpiresAt,
          nowMs: clockMs,
        });
        if (!decision.ok) {
          throw new ReferenceLeaseLostError(`completeReconciliation: ${decision.reason}`);
        }
        const now = new Date(clockMs).toISOString();
        const record: ReconciliationRecordShape = {
          ...existing!,
          status: "completed",
          leaseOwner: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
          completedAt: now,
        };
        const normalized = reconciliationRowToRecord(reconciliationRecordToRow(record));
        reconciliation.set(input.key, normalized);
      });
    },

    async failReconciliation(input) {
      return withLock(() => {
        const existing = reconciliation.get(input.key);
        const decision = decideLeaseMutation({
          exists: existing !== undefined,
          status: existing?.status ?? "",
          expectedStatus: "claimed",
          recordToken: existing?.leaseToken,
          providedToken: input.leaseToken,
          leaseExpiresAt: existing?.leaseExpiresAt,
          nowMs: clockMs,
        });
        if (!decision.ok) {
          throw new ReferenceLeaseLostError(`failReconciliation: ${decision.reason}`);
        }
        const now = new Date(clockMs).toISOString();
        const lastError = enforceMaxSanitizedError(input.error);
        const record: ReconciliationRecordShape = {
          ...existing!,
          status: "failed",
          leaseOwner: undefined,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        };
        if (lastError !== undefined) {
          record.lastError = lastError;
        }
        const normalized = reconciliationRowToRecord(reconciliationRecordToRow(record));
        reconciliation.set(input.key, normalized);
      });
    },

    getIdempotency(key) {
      return idempotency.get(key);
    },
    getWebhook(key) {
      return webhooks.get(key);
    },
    getReconciliation(key) {
      return reconciliation.get(key);
    },
  };

  return store;
}
