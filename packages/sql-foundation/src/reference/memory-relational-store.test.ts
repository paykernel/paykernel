/**
 * NEW-PKG-2 / NEW-SQL-1 locks for the NON-PRODUCTION memory-relational reference.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectedTablesForNamespace } from "../fixtures/migration-fixtures";
import { LOGICAL_TABLES } from "../schema/tables";
import { createMemoryRelationalStore } from "./memory-relational-store";

const STORE_SRC = readFileSync(join(import.meta.dir, "memory-relational-store.ts"), "utf8");

describe("NEW-PKG-2: memory-relational migrate applies DDL (does not invent tables)", () => {
  it("construction does not mark tables present", () => {
    const store = createMemoryRelationalStore();
    expect(store.NON_PRODUCTION).toBe(true);
    expect(store.NON_DISTRIBUTED).toBe(true);
    expect(store.listTables()).toEqual([]);
  });

  it("createExecutor does not invent tables on unrecognized always-ok SQL", () => {
    const store = createMemoryRelationalStore();
    const exec = store.createExecutor();
    expect(exec.execute("SELECT 1")).toEqual({ ok: true });
    expect(exec.execute("CREATE INDEX IF NOT EXISTS idx_x ON t (c)")).toEqual({ ok: true });
    expect(store.listTables()).toEqual([]);
  });

  it("createExecutor registers only the CREATE TABLE that ran", () => {
    const store = createMemoryRelationalStore();
    const exec = store.createExecutor();
    exec.execute(`CREATE TABLE IF NOT EXISTS "${LOGICAL_TABLES.idempotency}" (key TEXT)`);
    expect(store.listTables()).toEqual([LOGICAL_TABLES.idempotency]);
    expect(store.listTables()).not.toContain(LOGICAL_TABLES.webhookInbox);
  });

  it("sqlite migrate registers tables from applied CREATE TABLE", async () => {
    const store = createMemoryRelationalStore();
    const before = await store.verify("sqlite");
    expect(before.ok).toBe(false);
    expect(before.missing.length).toBeGreaterThan(0);

    const result = await store.migrate("sqlite");
    expect(result.applied).toEqual([1, 2]);

    const tables = store.listTables();
    for (const name of expectedTablesForNamespace()) {
      expect(tables).toContain(name);
    }

    const after = await store.verify("sqlite");
    expect(after.ok).toBe(true);
    expect(after.missing).toEqual([]);
    expect(after.version).toBe(2);
  });

  it("prefixed namespace registers prefixed physical names from CREATE TABLE", async () => {
    const store = createMemoryRelationalStore({
      namespace: { tablePrefix: "pay_" },
    });
    await store.migrate("sqlite");
    const tables = store.listTables();
    for (const name of expectedTablesForNamespace({ tablePrefix: "pay_" })) {
      expect(tables).toContain(name);
    }
    expect(tables).not.toContain(LOGICAL_TABLES.idempotency);
  });

  it("generic migrate does not invent domain tables from portable prose", async () => {
    const store = createMemoryRelationalStore();
    const result = await store.migrate("generic");
    expect(result.applied).toEqual([1, 2]);

    const tables = store.listTables();
    // ensureMigrationsTable actually issues CREATE TABLE for the ledger.
    expect(tables).toContain(LOGICAL_TABLES.storageMigrations);
    // portable v1 body is English intent, not CREATE TABLE.
    expect(tables).not.toContain(LOGICAL_TABLES.idempotency);
    expect(tables).not.toContain(LOGICAL_TABLES.webhookInbox);
    expect(tables).not.toContain(LOGICAL_TABLES.reconciliationJobs);

    const verified = await store.verify("generic");
    expect(verified.ok).toBe(false);
    expect(verified.missing).toContain(LOGICAL_TABLES.idempotency);
    expect(verified.missing).toContain(LOGICAL_TABLES.webhookInbox);
    expect(verified.missing).toContain(LOGICAL_TABLES.reconciliationJobs);
  });

  it("migrate() source does not tables.add every logical name after apply", () => {
    const start = STORE_SRC.indexOf("async migrate(");
    const end = STORE_SRC.indexOf("async verify(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const migrateFn = STORE_SRC.slice(start, end);
    expect(migrateFn).toContain("createExecutor");
    expect(migrateFn).toContain("await migrate(exec");
    expect(migrateFn).not.toMatch(/ALL_LOGICAL_TABLES/);
    expect(migrateFn).not.toMatch(/tables\.add\(resolveUnqualifiedTableName/);
  });
});

describe("NEW-SQL-1: decideWebhookClaim via memory-relational (idle supersedes)", () => {
  const nowMs = Date.parse("2026-01-15T12:00:00.000Z");

  it("active lease + different hash is payload_hash_conflict", async () => {
    const store = createMemoryRelationalStore({ nowMs });
    const first = await store.claimWebhook({
      key: "evt-sql1",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 60_000,
    });
    expect(first.kind).toBe("acquired");

    const conflict = await store.claimWebhook({
      key: "evt-sql1",
      payloadHash: "h2",
      owner: "w2",
      leaseMs: 60_000,
    });
    expect(conflict.kind).toBe("payload_hash_conflict");
    expect(store.getWebhook("evt-sql1")?.payloadHash).toBe("h1");
  });

  it("idle pending + different hash supersedes (not payload_hash_conflict)", async () => {
    const store = createMemoryRelationalStore({ nowMs });
    const first = await store.claimWebhook({
      key: "evt-sql1-idle",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 60_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") throw new Error("expected acquired");

    await store.failWebhook({
      key: "evt-sql1-idle",
      leaseToken: first.leaseToken,
      error: "park",
      retryAfterMs: 0,
    });
    expect(store.getWebhook("evt-sql1-idle")?.status).toBe("pending");

    const second = await store.claimWebhook({
      key: "evt-sql1-idle",
      payloadHash: "h2",
      owner: "w2",
      leaseMs: 60_000,
    });
    expect(second.kind).toBe("acquired");
    expect(store.getWebhook("evt-sql1-idle")?.payloadHash).toBe("h2");
  });

  it("S19 ifMatchPayloadHash miss does not rewrite an idle newer hash", async () => {
    const store = createMemoryRelationalStore({ nowMs });
    const first = await store.claimWebhook({
      key: "evt-s19-cas",
      payloadHash: "hash-a",
      owner: "w1",
      leaseMs: 60_000,
      payloadRef: JSON.stringify({ id: "old" }),
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") throw new Error("expected acquired");
    await store.failWebhook({
      key: "evt-s19-cas",
      leaseToken: first.leaseToken,
      error: "park a",
      retryAfterMs: 0,
    });

    const newer = await store.claimWebhook({
      key: "evt-s19-cas",
      payloadHash: "hash-b",
      owner: "w2",
      leaseMs: 60_000,
      payloadRef: JSON.stringify({ id: "new" }),
    });
    expect(newer.kind).toBe("acquired");
    if (newer.kind !== "acquired") throw new Error("expected supersede");
    await store.failWebhook({
      key: "evt-s19-cas",
      leaseToken: newer.leaseToken,
      error: "park b",
      retryAfterMs: 0,
    });

    const stale = await store.claimWebhook({
      key: "evt-s19-cas",
      payloadHash: "hash-a",
      owner: "worker",
      leaseMs: 60_000,
      payloadRef: JSON.stringify({ id: "old" }),
      ifMatchPayloadHash: "hash-a",
    });
    expect(stale.kind).toBe("payload_hash_conflict");
    expect(store.getWebhook("evt-s19-cas")?.payloadHash).toBe("hash-b");
    expect(store.getWebhook("evt-s19-cas")?.payloadRef).toBe(
      JSON.stringify({ id: "new" }),
    );
    expect(store.getWebhook("evt-s19-cas")?.status).toBe("pending");
  });

  it("pending backoff same hash is not_available; mismatch still supersedes", async () => {
    const store = createMemoryRelationalStore({ nowMs });
    const first = await store.claimWebhook({
      key: "evt-sql1-backoff",
      payloadHash: "h1",
      owner: "w1",
      leaseMs: 60_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") throw new Error("expected acquired");

    await store.failWebhook({
      key: "evt-sql1-backoff",
      leaseToken: first.leaseToken,
      error: "retry later",
      retryAfterMs: 60_000,
    });

    const blocked = await store.claimWebhook({
      key: "evt-sql1-backoff",
      payloadHash: "h1",
      owner: "w2",
      leaseMs: 60_000,
    });
    expect(blocked.kind).toBe("not_available");

    const supersede = await store.claimWebhook({
      key: "evt-sql1-backoff",
      payloadHash: "h2",
      owner: "w2",
      leaseMs: 60_000,
    });
    expect(supersede.kind).toBe("acquired");
    expect(store.getWebhook("evt-sql1-backoff")?.payloadHash).toBe("h2");
  });

  it("docs/contracts say idle mismatch supersedes (not unconditional conflict)", () => {
    const claims = readFileSync(
      join(import.meta.dir, "../../docs/atomic-claims.md"),
      "utf8",
    );
    expect(claims).toMatch(/payload_hash_conflict/);
    expect(claims).toMatch(/ifMatchPayloadHash/);
    expect(claims).toMatch(/supersede/i);

    const contracts = readFileSync(
      join(import.meta.dir, "../../../store-contracts/src/contracts.ts"),
      "utf8",
    );
    expect(contracts).not.toMatch(
      /completed → already_completed; different hash → payload_hash_conflict/,
    );
    expect(contracts).toMatch(/active lease.*payload_hash_conflict/s);
    expect(contracts).toMatch(/supersede/i);
  });
});
