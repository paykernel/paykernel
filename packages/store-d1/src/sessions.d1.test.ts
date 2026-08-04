/**
 * Sessions API helpers (withSession / first-primary) against mock D1.
 *
 * Documents: without sessions under D1 read replication, stale reads are possible
 * (manifest.staleReadsPossible). Claims remain primary writes.
 */
import { describe, expect, it } from "bun:test";
import {
  createD1Executor,
  createD1PaymentStores,
  createSessionScopedExecutor,
  scopeExecutorSession,
  supportsD1Sessions,
  withD1Session,
  D1_SESSION_FIRST_PRIMARY,
  D1_SESSION_FIRST_UNCONSTRAINED,
  D1_STORAGE_ADAPTER_MANIFEST,
  migrateD1Adapter,
} from "./index";
import { createMockD1 } from "./test-utils/mock-d1";
import { uniqueTablePrefix } from "./test-utils/d1-env";

describe("d1 sessions (mock)", () => {
  it("supportsD1Sessions is true for mock with sessions", () => {
    const handle = createMockD1({ sessions: true });
    try {
      expect(supportsD1Sessions(handle.db)).toBe(true);
    } finally {
      handle.close();
    }
  });

  it("withD1Session records first-primary constraint", () => {
    const handle = createMockD1();
    try {
      const scoped = withD1Session(handle.db, D1_SESSION_FIRST_PRIMARY);
      expect(scoped).toBeDefined();
      expect(typeof scoped.prepare).toBe("function");
      expect(handle.lastSessionConstraint).toBe("first-primary");
    } finally {
      handle.close();
    }
  });

  it("createD1Executor session option scopes binding", async () => {
    const handle = createMockD1();
    try {
      const executor = createD1Executor(handle.db, {
        session: "first-primary",
      });
      expect(handle.lastSessionConstraint).toBe("first-primary");
      const prefix = uniqueTablePrefix("ss");
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });
      const rows = await executor.query(`SELECT 1 AS ok`);
      expect(rows.length).toBe(1);
    } finally {
      handle.close();
    }
  });

  it("createSessionScopedExecutor + createD1PaymentStores session option", async () => {
    const handle = createMockD1();
    try {
      const scoped = createSessionScopedExecutor(
        handle.db,
        D1_SESSION_FIRST_PRIMARY,
      );
      expect(typeof scoped.query).toBe("function");
      expect(typeof scoped.withSession).toBe("function");

      const prefix = uniqueTablePrefix("sp");
      const stores = createD1PaymentStores({
        db: handle.db,
        session: "first-primary",
        namespace: { tablePrefix: prefix },
      });
      expect(stores.manifest.consistency.readAfterWrite).toBe("session");
      // Construction does not migrate
      await migrateD1Adapter(handle.db, { namespace: { tablePrefix: prefix } });
      const r = await stores.idempotency.reserve({
        key: "k",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 1000,
      });
      expect(r.kind).toBe("acquired");
      // Session-scoped write then read on same session binding (mock RAW).
      const got = await stores.idempotency.get("k");
      expect(got?.status).toBe("reserved");
      expect(handle.lastSessionConstraint).toBe("first-primary");
    } finally {
      handle.close();
    }
  });

  it("scopeExecutorSession / first-unconstrained constants work", () => {
    const handle = createMockD1();
    try {
      const base = createD1Executor(handle.db);
      const scoped = scopeExecutorSession(base, D1_SESSION_FIRST_UNCONSTRAINED);
      expect(typeof scoped.query).toBe("function");
      expect(handle.lastSessionConstraint).toBe("first-unconstrained");
    } finally {
      handle.close();
    }
  });

  it("supportsD1Sessions false when withSession missing", () => {
    const db = {
      prepare() {
        throw new Error("unused");
      },
      async batch() {
        return [];
      },
    };
    expect(supportsD1Sessions(db)).toBe(false);
    const passThrough = withD1Session(db, "first-primary");
    expect(passThrough).toBe(db);
  });

  it("documents stale reads possible without sessions under replication", () => {
    // Mock has no replicas — honesty is in the manifest / docs.
    expect(D1_STORAGE_ADAPTER_MANIFEST.consistency.staleReadsPossible).toBe(
      true,
    );
    expect(D1_STORAGE_ADAPTER_MANIFEST.consistency.readAfterWrite).toBe(
      "session",
    );
    expect(D1_STORAGE_ADAPTER_MANIFEST.consistency.claims).toBe("strong");
    const notes = D1_STORAGE_ADAPTER_MANIFEST.notes?.join(" ") ?? "";
    expect(notes.toLowerCase()).toContain("stale");
    expect(notes.toLowerCase()).toContain("session");
    expect(notes.toLowerCase()).toContain("replication");
  });

  it("session-scoped reads after writes when mock supports sessions", async () => {
    const handle = createMockD1({ sessions: true });
    try {
      const prefix = uniqueTablePrefix("sr");
      const executor = createSessionScopedExecutor(
        handle.db,
        D1_SESSION_FIRST_PRIMARY,
      );
      await migrateD1Adapter(executor, { namespace: { tablePrefix: prefix } });

      const now = "2020-01-01T00:00:00.000Z";
      await executor.execute(
        `INSERT INTO ${prefix}payment_idempotency (
          key, status, fingerprint, attempts, generation, created_at, updated_at
        ) VALUES (?, 'reserved', ?, 1, 1, ?, ?)`,
        ["session-raw", "fp", now, now],
      );

      // Same session executor sees the write immediately (primary-first path).
      const rows = await executor.query<{ key: string }>(
        `SELECT key FROM ${prefix}payment_idempotency WHERE key = ?`,
        ["session-raw"],
      );
      expect(rows.map((r) => r.key)).toEqual(["session-raw"]);
      expect(handle.lastSessionConstraint).toBe("first-primary");
    } finally {
      handle.close();
    }
  });
});
