/**
 * bun:sqlite reference store for foundation claim proofs.
 *
 * ⚠️ NON-PRODUCTION / NON-DISTRIBUTED / foundation tests only.
 * - Requires Bun runtime (`bun:sqlite`).
 * - NOT multi-host safe beyond single SQLite file + single process.
 * - Claims run inside a **single synchronous** `db.transaction()` callback
 *   with **no await** inside the callback — proves engine-level serialization
 *   is not get-then-set.
 *
 * Do not import this module from portable consumers that must not pull
 * `bun:sqlite`. Import explicitly:
 *   `import { createBunSqliteRelationalStore } from ".../reference/bun-sqlite-store"`
 *
 * Production SQLite stores: `packages/store-sqlite` (`@paykernel/store-sqlite`, Phase 14).
 * This module remains a foundation-only reference for claim contention proofs.
 */

import { Database } from "bun:sqlite";
import {
  decideIdempotencyReserve,
  decideLeaseMutation,
  decideWebhookClaim,
  type IdempotencyExistingSnapshot,
  type WebhookExistingSnapshot,
} from "../claims/algorithm";
import { enforceMaxSanitizedError } from "../codecs/validation";
import {
  createSchemaNamespace,
  resolveUnqualifiedTableName,
  type ResolvedSchemaNamespace,
  type SchemaNamespaceConfig,
} from "../schema/namespace";
import { LOGICAL_TABLES } from "../schema/tables";
import { buildFoundationMigrationSql } from "../migrations/definitions";
import { ReferenceLeaseLostError } from "./memory-relational-store";

export const BUN_SQLITE_ATOMICITY_MODEL = "sqlite_single_sync_transaction" as const;

export type BunSqliteRelationalOptions = {
  namespace?: SchemaNamespaceConfig;
  /** Starting clock ms. */
  nowMs?: number;
  /**
   * SQLite path. Default `:memory:` for tests.
   * File paths are allowed for multi-connection same-file experiments.
   */
  path?: string;
  /**
   * When true (default), apply foundation DDL once in constructor.
   * Explicit opt-in for the reference only — production adapters must never
   * auto-migrate on package import; this is test construction, not import.
   */
  applySchemaOnCreate?: boolean;
};

type IdemRow = {
  key: string;
  status: string;
  fingerprint: string;
  result_json: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempts: number;
  generation: number;
  created_at: string;
  updated_at: string;
};

type WebhookRow = {
  key: string;
  status: string;
  payload_hash: string;
  payload_ref: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempts: number;
  generation: number;
  available_at: string;
  created_at: string;
  updated_at: string;
  last_error_sanitized: string | null;
};

function newLeaseToken(nowMs: number, generation: number): string {
  return `lease_${nowMs}_${generation}_${Math.random().toString(36).slice(2, 12)}`;
}

export type BunSqliteRelationalStore = {
  readonly NON_PRODUCTION: true;
  readonly NON_DISTRIBUTED: true;
  readonly atomicityModel: typeof BUN_SQLITE_ATOMICITY_MODEL;
  readonly namespace: ResolvedSchemaNamespace;
  readonly db: Database;

  setNowMs(ms: number): void;
  nowMs(): number;
  close(): void;

  /** Explicit DDL apply (idempotent CREATE IF NOT EXISTS). */
  applySchema(): void;

  reserveIdempotency(input: { key: string; fingerprint: string; owner: string; leaseMs: number }):
    | {
        kind: "acquired";
        generation: number;
        attempts: number;
        leaseToken: string;
      }
    | { kind: "already_completed" }
    | { kind: "in_progress" }
    | { kind: "indeterminate" }
    | { kind: "fingerprint_conflict" };

  completeIdempotency(input: { key: string; leaseToken: string; result: unknown }): void;

  claimWebhook(input: { key: string; payloadHash: string; owner: string; leaseMs: number }):
    | {
        kind: "acquired";
        generation: number;
        attempts: number;
        leaseToken: string;
      }
    | { kind: "already_completed" }
    | { kind: "in_progress" }
    | { kind: "payload_hash_conflict" }
    | { kind: "duplicate_failed" };

  completeWebhook(input: { key: string; leaseToken: string }): void;

  failWebhook(input: {
    key: string;
    leaseToken: string;
    error: string;
    deadLetter?: boolean;
  }): void;
};

/**
 * Create bun:sqlite relational reference.
 * Claim paths use `db.transaction(() => { ... })` with no await inside.
 */
export function createBunSqliteRelationalStore(
  options: BunSqliteRelationalOptions = {},
): BunSqliteRelationalStore {
  const namespace = createSchemaNamespace(options.namespace ?? {});
  let clockMs = options.nowMs ?? Date.now();
  const path = options.path ?? ":memory:";
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  const tIdem = resolveUnqualifiedTableName(LOGICAL_TABLES.idempotency, namespace);
  const tWh = resolveUnqualifiedTableName(LOGICAL_TABLES.webhookInbox, namespace);
  const tRecon = resolveUnqualifiedTableName(LOGICAL_TABLES.reconciliationJobs, namespace);
  const tMig = resolveUnqualifiedTableName(LOGICAL_TABLES.storageMigrations, namespace);

  function qualify(logical: string): string {
    // Unqualified physical name already includes prefix; quote for SQL.
    const map: Record<string, string> = {
      payment_idempotency: tIdem,
      payment_webhook_inbox: tWh,
      payment_reconciliation_jobs: tRecon,
      payment_storage_migrations: tMig,
    };
    const name = map[logical] ?? logical;
    return `"${name.replace(/"/g, '""')}"`;
  }

  function applySchema(): void {
    const sql = buildFoundationMigrationSql("sqlite", qualify);
    db.exec(sql);
  }

  if (options.applySchemaOnCreate !== false) {
    applySchema();
  }

  const selectIdem = db.query(
    `SELECT key, status, fingerprint, result_json, lease_owner, lease_token,
            lease_expires_at, attempts, generation, created_at, updated_at
     FROM "${tIdem}" WHERE key = ?`,
  );
  const insertIdem = db.query(
    `INSERT INTO "${tIdem}" (
       key, status, fingerprint, lease_owner, lease_token, lease_expires_at,
       attempts, generation, created_at, updated_at
     ) VALUES (?, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Reclaim UPDATE re-checks reclaim eligibility (expired lease / status) so a
  // mid-transaction logical drift cannot overwrite an active foreign lease even
  // if pure decide and write were somehow inconsistent. Still runs inside one
  // sync transaction with no await.
  const updateIdemReserve = db.query(
    `UPDATE "${tIdem}" SET
       status = 'reserved',
       lease_owner = ?,
       lease_token = ?,
       lease_expires_at = ?,
       attempts = ?,
       generation = ?,
       updated_at = ?
     WHERE key = ?
       AND fingerprint = ?
       AND status NOT IN ('completed', 'indeterminate')
       AND (
         status = 'expired'
         OR lease_expires_at IS NULL
         OR lease_expires_at <= ?
       )`,
  );
  const updateIdemComplete = db.query(
    `UPDATE "${tIdem}" SET
       status = 'completed',
       result_json = ?,
       lease_owner = NULL,
       lease_token = NULL,
       lease_expires_at = NULL,
       completed_at = ?,
       updated_at = ?
     WHERE key = ?
       AND lease_token = ?
       AND status = 'reserved'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at > ?`,
  );

  const selectWh = db.query(
    `SELECT key, status, payload_hash, payload_ref, lease_owner, lease_token,
            lease_expires_at, attempts, generation, available_at, created_at,
            updated_at, last_error_sanitized
     FROM "${tWh}" WHERE key = ?`,
  );
  const insertWh = db.query(
    `INSERT INTO "${tWh}" (
       key, status, payload_hash, payload_ref, lease_owner, lease_token,
       lease_expires_at, attempts, generation, available_at, created_at, updated_at
     ) VALUES (?, 'claimed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateWhClaim = db.query(
    `UPDATE "${tWh}" SET
       status = 'claimed',
       payload_ref = COALESCE(?, payload_ref),
       lease_owner = ?,
       lease_token = ?,
       lease_expires_at = ?,
       attempts = ?,
       generation = ?,
       available_at = ?,
       updated_at = ?
     WHERE key = ?
       AND payload_hash = ?
       AND status NOT IN ('completed', 'failed', 'dead_letter')
       AND (
         status = 'pending'
         OR lease_expires_at IS NULL
         OR lease_expires_at <= ?
       )`,
  );
  const updateWhComplete = db.query(
    `UPDATE "${tWh}" SET
       status = 'completed',
       lease_owner = NULL,
       lease_token = NULL,
       lease_expires_at = NULL,
       completed_at = ?,
       updated_at = ?
     WHERE key = ?
       AND lease_token = ?
       AND status = 'claimed'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at > ?`,
  );
  const updateWhFail = db.query(
    `UPDATE "${tWh}" SET
       status = ?,
       last_error_sanitized = ?,
       lease_owner = NULL,
       lease_token = NULL,
       lease_expires_at = NULL,
       available_at = ?,
       updated_at = ?
     WHERE key = ?
       AND lease_token = ?
       AND status = 'claimed'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at > ?`,
  );

  // Single-sync-transaction claim: evaluate pure decision + conditional write.
  // No await inside — SQLite serializes writers; decision+write is one critical section.
  const reserveIdemTx = db.transaction(
    (input: { key: string; fingerprint: string; owner: string; leaseMs: number }) => {
      const row = selectIdem.get(input.key) as IdemRow | null;
      let existing: IdempotencyExistingSnapshot | undefined;
      if (row) {
        existing = {
          status: row.status as IdempotencyExistingSnapshot["status"],
          fingerprint: row.fingerprint,
          leaseExpiresAt: row.lease_expires_at,
          generation: row.generation,
          attempts: row.attempts,
          createdAt: row.created_at,
        };
      }
      const token = newLeaseToken(clockMs, (row?.generation ?? 0) + 1);
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
        return { kind: decision.kind } as const;
      }
      if (decision.action === "insert") {
        try {
          insertIdem.run(
            input.key,
            decision.fingerprint,
            decision.leaseOwner,
            decision.leaseToken,
            decision.leaseExpiresAt,
            decision.attempts,
            decision.generation,
            decision.createdAt,
            decision.updatedAt,
          );
        } catch {
          // Unique race under multi-connection: peer inserted first. Re-read.
          const peer = selectIdem.get(input.key) as IdemRow | null;
          if (peer?.status === "reserved") {
            return { kind: "in_progress" as const };
          }
          if (peer?.status === "completed") {
            return { kind: "already_completed" as const };
          }
          if (peer?.status === "indeterminate") {
            return { kind: "indeterminate" as const };
          }
          if (peer && peer.fingerprint !== input.fingerprint) {
            return { kind: "fingerprint_conflict" as const };
          }
          throw new Error("reserveIdempotency: insert failed without recoverable peer row");
        }
      } else {
        const nowIso = new Date(clockMs).toISOString();
        const changes = updateIdemReserve.run(
          decision.leaseOwner,
          decision.leaseToken,
          decision.leaseExpiresAt,
          decision.attempts,
          decision.generation,
          decision.updatedAt,
          input.key,
          decision.fingerprint,
          nowIso,
        );
        if (changes.changes !== 1) {
          // Lost reclaim race — re-evaluate against peer's current row.
          const peer = selectIdem.get(input.key) as IdemRow | null;
          if (!peer) return { kind: "in_progress" as const };
          const peerDecision = decideIdempotencyReserve({
            key: input.key,
            fingerprint: input.fingerprint,
            owner: input.owner,
            leaseMs: input.leaseMs,
            newLeaseToken: token,
            clock: { nowMs: clockMs },
            existing: {
              status: peer.status as IdempotencyExistingSnapshot["status"],
              fingerprint: peer.fingerprint,
              leaseExpiresAt: peer.lease_expires_at,
              generation: peer.generation,
              attempts: peer.attempts,
              createdAt: peer.created_at,
            },
          });
          if (peerDecision.kind === "acquired") {
            // Extremely rare: became reclaimable again mid-txn. Report in_progress
            // rather than looping inside the transaction.
            return { kind: "in_progress" as const };
          }
          return { kind: peerDecision.kind } as const;
        }
      }
      return {
        kind: "acquired" as const,
        generation: decision.generation,
        attempts: decision.attempts,
        leaseToken: decision.leaseToken,
      };
    },
  );

  const claimWhTx = db.transaction(
    (input: { key: string; payloadHash: string; owner: string; leaseMs: number }) => {
      const row = selectWh.get(input.key) as WebhookRow | null;
      let existing: WebhookExistingSnapshot | undefined;
      if (row) {
        existing = {
          status: row.status as WebhookExistingSnapshot["status"],
          payloadHash: row.payload_hash,
          leaseExpiresAt: row.lease_expires_at,
          generation: row.generation,
          attempts: row.attempts,
          createdAt: row.created_at,
          availableAt: row.available_at,
          payloadRef: row.payload_ref ?? undefined,
        };
      }
      const token = newLeaseToken(clockMs, (row?.generation ?? 0) + 1);
      const decision = decideWebhookClaim({
        key: input.key,
        payloadHash: input.payloadHash,
        owner: input.owner,
        leaseMs: input.leaseMs,
        newLeaseToken: token,
        clock: { nowMs: clockMs },
        existing,
      });
      if (decision.kind !== "acquired") {
        return { kind: decision.kind } as const;
      }
      if (decision.action === "insert") {
        try {
          insertWh.run(
            input.key,
            decision.payloadHash,
            decision.payloadRef ?? null,
            decision.leaseOwner,
            decision.leaseToken,
            decision.leaseExpiresAt,
            decision.attempts,
            decision.generation,
            decision.availableAt,
            decision.createdAt,
            decision.updatedAt,
          );
        } catch {
          const peer = selectWh.get(input.key) as WebhookRow | null;
          if (peer && peer.payload_hash !== input.payloadHash) {
            return { kind: "payload_hash_conflict" as const };
          }
          if (peer?.status === "claimed") {
            return { kind: "in_progress" as const };
          }
          if (peer?.status === "completed") {
            return { kind: "already_completed" as const };
          }
          if (peer?.status === "failed" || peer?.status === "dead_letter") {
            return { kind: "duplicate_failed" as const };
          }
          throw new Error("claimWebhook: insert failed without recoverable peer row");
        }
      } else {
        const nowIso = new Date(clockMs).toISOString();
        const changes = updateWhClaim.run(
          decision.payloadRef ?? null,
          decision.leaseOwner,
          decision.leaseToken,
          decision.leaseExpiresAt,
          decision.attempts,
          decision.generation,
          decision.availableAt,
          decision.updatedAt,
          input.key,
          input.payloadHash,
          nowIso,
        );
        if (changes.changes !== 1) {
          const peer = selectWh.get(input.key) as WebhookRow | null;
          if (!peer) return { kind: "in_progress" as const };
          const peerDecision = decideWebhookClaim({
            key: input.key,
            payloadHash: input.payloadHash,
            owner: input.owner,
            leaseMs: input.leaseMs,
            newLeaseToken: token,
            clock: { nowMs: clockMs },
            existing: {
              status: peer.status as WebhookExistingSnapshot["status"],
              payloadHash: peer.payload_hash,
              leaseExpiresAt: peer.lease_expires_at,
              generation: peer.generation,
              attempts: peer.attempts,
              createdAt: peer.created_at,
              availableAt: peer.available_at,
              payloadRef: peer.payload_ref ?? undefined,
            },
          });
          if (peerDecision.kind === "acquired") {
            return { kind: "in_progress" as const };
          }
          return { kind: peerDecision.kind } as const;
        }
      }
      return {
        kind: "acquired" as const,
        generation: decision.generation,
        attempts: decision.attempts,
        leaseToken: decision.leaseToken,
      };
    },
  );

  const completeIdemTx = db.transaction(
    (input: { key: string; leaseToken: string; result: unknown }) => {
      const row = selectIdem.get(input.key) as IdemRow | null;
      const decision = decideLeaseMutation({
        exists: row !== null && row !== undefined,
        status: row?.status ?? "",
        expectedStatus: "reserved",
        recordToken: row?.lease_token,
        providedToken: input.leaseToken,
        leaseExpiresAt: row?.lease_expires_at,
        nowMs: clockMs,
      });
      if (!decision.ok) {
        throw new ReferenceLeaseLostError(`completeIdempotency: ${decision.reason}`);
      }
      const now = new Date(clockMs).toISOString();
      const changes = updateIdemComplete.run(
        JSON.stringify(input.result),
        now,
        now,
        input.key,
        input.leaseToken,
        now,
      );
      if (changes.changes !== 1) {
        throw new ReferenceLeaseLostError("completeIdempotency: conditional update matched 0 rows");
      }
    },
  );

  const completeWhTx = db.transaction((input: { key: string; leaseToken: string }) => {
    const row = selectWh.get(input.key) as WebhookRow | null;
    const decision = decideLeaseMutation({
      exists: row !== null && row !== undefined,
      status: row?.status ?? "",
      expectedStatus: "claimed",
      recordToken: row?.lease_token,
      providedToken: input.leaseToken,
      leaseExpiresAt: row?.lease_expires_at,
      nowMs: clockMs,
    });
    if (!decision.ok) {
      throw new ReferenceLeaseLostError(`completeWebhook: ${decision.reason}`);
    }
    const now = new Date(clockMs).toISOString();
    const changes = updateWhComplete.run(now, now, input.key, input.leaseToken, now);
    if (changes.changes !== 1) {
      throw new ReferenceLeaseLostError("completeWebhook: conditional update matched 0 rows");
    }
  });

  const failWhTx = db.transaction(
    (input: { key: string; leaseToken: string; error: string; deadLetter?: boolean }) => {
      const row = selectWh.get(input.key) as WebhookRow | null;
      const decision = decideLeaseMutation({
        exists: row !== null && row !== undefined,
        status: row?.status ?? "",
        expectedStatus: "claimed",
        recordToken: row?.lease_token,
        providedToken: input.leaseToken,
        leaseExpiresAt: row?.lease_expires_at,
        nowMs: clockMs,
      });
      if (!decision.ok) {
        throw new ReferenceLeaseLostError(`failWebhook: ${decision.reason}`);
      }
      const now = new Date(clockMs).toISOString();
      const status = input.deadLetter === true ? "dead_letter" : "pending";
      const lastError = enforceMaxSanitizedError(input.error) ?? null;
      const changes = updateWhFail.run(
        status,
        lastError,
        now,
        now,
        input.key,
        input.leaseToken,
        now,
      );
      if (changes.changes !== 1) {
        throw new ReferenceLeaseLostError("failWebhook: conditional update matched 0 rows");
      }
    },
  );

  return {
    NON_PRODUCTION: true,
    NON_DISTRIBUTED: true,
    atomicityModel: BUN_SQLITE_ATOMICITY_MODEL,
    namespace,
    db,

    setNowMs(ms: number) {
      clockMs = ms;
    },
    nowMs() {
      return clockMs;
    },
    close() {
      db.close();
    },
    applySchema,

    reserveIdempotency(input) {
      return reserveIdemTx(input);
    },
    completeIdempotency(input) {
      completeIdemTx(input);
    },
    claimWebhook(input) {
      return claimWhTx(input);
    },
    completeWebhook(input) {
      completeWhTx(input);
    },
    failWebhook(input) {
      failWhTx(input);
    },
  };
}


