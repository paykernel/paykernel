/**
 * Concurrent claim contention + consistency proofs (Phase 15.3).
 *
 * - libsql :memory: / file: when @libsql/client is available (CI path)
 * - live remote multi-connection when TURSO_ / LIBSQL_ env set (skip-clean otherwise)
 *
 * Proves single-statement UPSERT claim atomicity under parallel reserves,
 * FakeClock lease reclaim, stale-token fencing, txn rollback, read-after-write,
 * and multi-instance (two store instances / two clients).
 */
import { describe, expect, it } from "bun:test";
import { createFakeClock, StoreLeaseLostError } from "@paykernel/testkit";
import {
  createTursoIdempotencyStore,
  createTursoWebhookInboxStore,
  migrateTursoAdapter,
} from "./index";
import {
  hasLiveTurso,
  isRemoteTursoUrl,
  TURSO_AUTH_TOKEN,
  TURSO_DATABASE_URL,
  uniqueTablePrefix,
} from "./test-utils/turso-env";

async function openLibsqlMemory(): Promise<{
  client: { close: () => void };
  executor: import("./executor").TursoExecutor;
} | null> {
  try {
    const { createClient } = await import("@libsql/client");
    const client = createClient({ url: ":memory:" });
    const { createLibsqlExecutor } = await import("./drivers/libsql");
    return { client, executor: createLibsqlExecutor(client) };
  } catch {
    return null;
  }
}

describe("turso claim concurrency (libsql skip-clean)", () => {
  it("only one worker acquires a fresh key under parallel reserve", async () => {
    const opened = await openLibsqlMemory();
    if (!opened) return;
    const { client, executor } = opened;
    try {
      const prefix = "cx_";
      await migrateTursoAdapter(executor, { namespace: { tablePrefix: prefix } });

      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const workers = 8;
      const stores = Array.from({ length: workers }, () =>
        createTursoIdempotencyStore({
          executor,
          clock,
          namespace: { tablePrefix: prefix },
        }),
      );

      const key = "contention-key";
      const results = await Promise.all(
        stores.map((store, i) =>
          store.reserve({
            key,
            fingerprint: "fp",
            owner: `w${i}`,
            leaseMs: 30_000,
          }),
        ),
      );

      const acquired = results.filter((r) => r.kind === "acquired");
      const inProgress = results.filter((r) => r.kind === "in_progress");
      expect(acquired.length).toBe(1);
      expect(inProgress.length).toBe(workers - 1);
      if (acquired[0]?.kind === "acquired") {
        expect(acquired[0].record.generation).toBe(1);
        expect(acquired[0].leaseToken.length).toBeGreaterThan(8);
      }
    } finally {
      client.close();
    }
  });

  it("FakeClock lease expiry allows reclaim with generation++", async () => {
    const opened = await openLibsqlMemory();
    if (!opened) return;
    const { client, executor } = opened;
    try {
      const prefix = "lx_";
      await migrateTursoAdapter(executor, { namespace: { tablePrefix: prefix } });

      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createTursoIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const first = await store.reserve({
        key: "lease-reclaim",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 5_000,
      });
      expect(first.kind).toBe("acquired");
      if (first.kind !== "acquired") return;

      const blocked = await store.reserve({
        key: "lease-reclaim",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 5_000,
      });
      expect(blocked.kind).toBe("in_progress");

      clock.advance(6_000);

      const reclaimed = await store.reserve({
        key: "lease-reclaim",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 5_000,
      });
      expect(reclaimed.kind).toBe("acquired");
      if (reclaimed.kind === "acquired") {
        expect(reclaimed.record.generation).toBe(2);
        expect(reclaimed.leaseToken).not.toBe(first.leaseToken);
      }
    } finally {
      client.close();
    }
  });

  it("stale lease complete/fail throws StoreLeaseLostError after reclaim", async () => {
    const opened = await openLibsqlMemory();
    if (!opened) return;
    const { client, executor } = opened;
    try {
      const prefix = "st_";
      await migrateTursoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createTursoIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const r1 = await store.reserve({
        key: "stale1",
        fingerprint: "fp",
        owner: "w1",
        leaseMs: 1_000,
      });
      expect(r1.kind).toBe("acquired");
      if (r1.kind !== "acquired") return;

      clock.advance(2_000);

      const r2 = await store.reserve({
        key: "stale1",
        fingerprint: "fp",
        owner: "w2",
        leaseMs: 5_000,
      });
      expect(r2.kind).toBe("acquired");
      if (r2.kind !== "acquired") return;

      await expect(
        store.complete({ key: "stale1", leaseToken: r1.leaseToken, result: {} }),
      ).rejects.toBeInstanceOf(StoreLeaseLostError);

      await store.complete({
        key: "stale1",
        leaseToken: r2.leaseToken,
        result: { ok: true },
      });
      const got = await store.get("stale1");
      expect(got?.status).toBe("completed");
    } finally {
      client.close();
    }
  });

  it("read-after-write: get reflects claim immediately", async () => {
    const opened = await openLibsqlMemory();
    if (!opened) return;
    const { client, executor } = opened;
    try {
      const prefix = "rw_";
      await migrateTursoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const store = createTursoIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const r = await store.reserve({
        key: "raw-key",
        fingerprint: "fp-raw",
        owner: "owner-a",
        leaseMs: 10_000,
      });
      expect(r.kind).toBe("acquired");
      if (r.kind !== "acquired") return;

      const got = await store.get("raw-key");
      expect(got).toBeDefined();
      expect(got?.status).toBe("reserved");
      expect(got?.leaseOwner).toBe("owner-a");
      expect(got?.leaseToken).toBe(r.leaseToken);
      expect(got?.fingerprint).toBe("fp-raw");
    } finally {
      client.close();
    }
  });

  it("multi-instance: two store instances same DB different owners → one winner", async () => {
    const opened = await openLibsqlMemory();
    if (!opened) return;
    const { client, executor } = opened;
    try {
      const prefix = "mi_";
      await migrateTursoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      // Distinct store instances (simulating two app instances) share executor/DB.
      const instanceA = createTursoIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });
      const instanceB = createTursoIdempotencyStore({
        executor,
        clock,
        namespace: { tablePrefix: prefix },
      });

      const results = await Promise.all([
        instanceA.reserve({
          key: "multi-inst",
          fingerprint: "fp",
          owner: "instance-a",
          leaseMs: 30_000,
        }),
        instanceB.reserve({
          key: "multi-inst",
          fingerprint: "fp",
          owner: "instance-b",
          leaseMs: 30_000,
        }),
      ]);
      const acquired = results.filter((r) => r.kind === "acquired");
      expect(acquired.length).toBe(1);
      if (acquired[0]?.kind === "acquired") {
        expect(["instance-a", "instance-b"]).toContain(
          acquired[0].record.leaseOwner,
        );
      }
    } finally {
      client.close();
    }
  });

  it("transaction rollback is atomic (batch/txn)", async () => {
    const opened = await openLibsqlMemory();
    if (!opened) return;
    const { client, executor } = opened;
    try {
      expect(typeof executor.transaction).toBe("function");
      await executor.execute(
        "CREATE TABLE IF NOT EXISTS tx_probe (id TEXT PRIMARY KEY, v INTEGER)",
        [],
      );
      await executor.execute("DELETE FROM tx_probe", []);

      await expect(
        executor.transaction!(async (tx) => {
          await tx.execute("INSERT INTO tx_probe (id, v) VALUES (?, ?)", [
            "a",
            1,
          ]);
          await tx.execute("INSERT INTO tx_probe (id, v) VALUES (?, ?)", [
            "b",
            2,
          ]);
          throw new Error("force-rollback");
        }),
      ).rejects.toThrow("force-rollback");

      const rows = await executor.query<{ id: string }>(
        "SELECT id FROM tx_probe ORDER BY id",
        [],
      );
      expect(rows.length).toBe(0);

      // Successful commit path
      await executor.transaction!(async (tx) => {
        await tx.execute("INSERT INTO tx_probe (id, v) VALUES (?, ?)", [
          "c",
          3,
        ]);
      });
      const after = await executor.query("SELECT id FROM tx_probe", []);
      expect(after.length).toBe(1);
    } finally {
      client.close();
    }
  });

  it("webhook concurrent claims: exactly one winner", async () => {
    const opened = await openLibsqlMemory();
    if (!opened) return;
    const { client, executor } = opened;
    try {
      const prefix = "wh_";
      await migrateTursoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const clock = createFakeClock({ initialMs: 1_700_000_000_000 });
      const stores = Array.from({ length: 6 }, () =>
        createTursoWebhookInboxStore({
          executor,
          clock,
          namespace: { tablePrefix: prefix },
        }),
      );
      const results = await Promise.all(
        stores.map((store, i) =>
          store.claim({
            key: "wh-event-1",
            payloadHash: "hash-1",
            owner: `wh${i}`,
            leaseMs: 15_000,
          }),
        ),
      );
      const acquired = results.filter((r) => r.kind === "acquired");
      expect(acquired.length).toBe(1);
      expect(results.filter((r) => r.kind === "in_progress").length).toBe(5);
    } finally {
      client.close();
    }
  });
});

describe("turso claim concurrency (live remote skip-clean)", () => {
  it(
    "multi-connection parallel reserve on shared remote DB",
    async () => {
      if (!hasLiveTurso() || !isRemoteTursoUrl()) {
        return;
      }
      let openOk = false;
      try {
        const { createClient } = await import("@libsql/client");
        const url = TURSO_DATABASE_URL!;
        const authToken = TURSO_AUTH_TOKEN;
        const makeClient = () => {
          const cfg: { url: string; authToken?: string } = { url };
          if (authToken) cfg.authToken = authToken;
          return createClient(cfg);
        };

        const clients = [makeClient(), makeClient()];
        openOk = true;
        const { createLibsqlExecutor } = await import("./drivers/libsql");
        const executors = clients.map((c) => createLibsqlExecutor(c));
        const prefix = uniqueTablePrefix("cc");
        await migrateTursoAdapter(executors[0]!, {
          namespace: { tablePrefix: prefix },
        });

        const clock = createFakeClock({ initialMs: Date.now() });
        const stores = executors.map((executor) =>
          createTursoIdempotencyStore({
            executor,
            clock,
            namespace: { tablePrefix: prefix },
          }),
        );

        const key = `live-contention-${Date.now()}`;
        const results = await Promise.all(
          stores.map((store, i) =>
            store.reserve({
              key,
              fingerprint: "fp",
              owner: `w${i}`,
              leaseMs: 30_000,
            }),
          ),
        );
        const acquired = results.filter((r) => r.kind === "acquired");
        expect(acquired.length).toBe(1);

        for (const c of clients) c.close();
      } catch (err) {
        if (openOk) throw err;
        return;
      }
    },
    { timeout: 60_000 },
  );

  it(
    "multi-instance remote: two clients two owners → one winner + RAW",
    async () => {
      if (!hasLiveTurso() || !isRemoteTursoUrl()) {
        return;
      }
      let openOk = false;
      try {
        const { createClient } = await import("@libsql/client");
        const url = TURSO_DATABASE_URL!;
        const makeClient = () => {
          const cfg: { url: string; authToken?: string } = { url };
          if (TURSO_AUTH_TOKEN) cfg.authToken = TURSO_AUTH_TOKEN;
          return createClient(cfg);
        };
        const clientA = makeClient();
        const clientB = makeClient();
        openOk = true;
        const { createLibsqlExecutor } = await import("./drivers/libsql");
        const execA = createLibsqlExecutor(clientA);
        const execB = createLibsqlExecutor(clientB);
        const prefix = uniqueTablePrefix("mi");
        await migrateTursoAdapter(execA, { namespace: { tablePrefix: prefix } });
        const clock = createFakeClock({ initialMs: Date.now() });
        const storeA = createTursoIdempotencyStore({
          executor: execA,
          clock,
          namespace: { tablePrefix: prefix },
        });
        const storeB = createTursoIdempotencyStore({
          executor: execB,
          clock,
          namespace: { tablePrefix: prefix },
        });
        const key = `live-mi-${Date.now()}`;
        const results = await Promise.all([
          storeA.reserve({
            key,
            fingerprint: "fp",
            owner: "remote-a",
            leaseMs: 30_000,
          }),
          storeB.reserve({
            key,
            fingerprint: "fp",
            owner: "remote-b",
            leaseMs: 30_000,
          }),
        ]);
        expect(results.filter((r) => r.kind === "acquired").length).toBe(1);
        const winner = results.find((r) => r.kind === "acquired");
        if (winner?.kind === "acquired") {
          const got = await storeB.get(key);
          expect(got?.leaseToken).toBe(winner.leaseToken);
          expect(got?.status).toBe("reserved");
        }
        clientA.close();
        clientB.close();
      } catch (err) {
        if (openOk) throw err;
        return;
      }
    },
    { timeout: 60_000 },
  );
});

/**
 * Serverless multi-connection path is independent from libsql (roadmap §30).
 * Skip cleanly without TURSO_DATABASE_URL (+ auth). Does not use file: (serverless is remote-only).
 */
describe("turso serverless concurrency (live skip-clean)", () => {
  it(
    "skips without remote Turso env; multi-connection when available",
    async () => {
      if (!hasLiveTurso() || !isRemoteTursoUrl()) {
        // Clean skip — no throw. Documents timeout/reconnect: remote failures map via mapDriverError.
        expect(hasLiveTurso() && isRemoteTursoUrl()).toBe(false);
        return;
      }
      let openOk = false;
      try {
        const { connect } = await import("@tursodatabase/serverless");
        const cfg: { url: string; authToken?: string } = {
          url: TURSO_DATABASE_URL!,
        };
        if (TURSO_AUTH_TOKEN) cfg.authToken = TURSO_AUTH_TOKEN;
        // Separate connections for true parallelism (serverless single-stream per conn).
        const connA = connect(cfg);
        const connB = connect(cfg);
        openOk = true;
        const { createTursoServerlessExecutor } = await import(
          "./drivers/serverless"
        );
        const execA = createTursoServerlessExecutor(connA);
        const execB = createTursoServerlessExecutor(connB);
        const prefix = uniqueTablePrefix("sv");
        await migrateTursoAdapter(execA, { namespace: { tablePrefix: prefix } });
        const clock = createFakeClock({ initialMs: Date.now() });
        const storeA = createTursoIdempotencyStore({
          executor: execA,
          clock,
          namespace: { tablePrefix: prefix },
        });
        const storeB = createTursoIdempotencyStore({
          executor: execB,
          clock,
          namespace: { tablePrefix: prefix },
        });
        const key = `sv-race-${Date.now()}`;
        const results = await Promise.all([
          storeA.reserve({
            key,
            fingerprint: "fp",
            owner: "sv-a",
            leaseMs: 30_000,
          }),
          storeB.reserve({
            key,
            fingerprint: "fp",
            owner: "sv-b",
            leaseMs: 30_000,
          }),
        ]);
        expect(results.filter((r) => r.kind === "acquired").length).toBe(1);
        await connA.close?.();
        await connB.close?.();
      } catch (err) {
        if (openOk) throw err;
        return;
      }
    },
    { timeout: 60_000 },
  );
});
