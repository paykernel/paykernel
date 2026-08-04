/**
 * Serverless binding live tests (Phase 15.1 / 15.3).
 *
 * Skip cleanly when TURSO_DATABASE_URL / PAYMENTS_SDK_TURSO_URL (and auth if required)
 * are unset — CI without remote Turso stays green.
 *
 * Independent from @libsql/client path (not interchangeable).
 */
import { describe, expect, it } from "bun:test";
import {
  createFakeClock,
  runIdempotencyStoreConformanceSuite,
  type StoreConformanceReport,
} from "@paykernel/testkit";
import {
  createTursoIdempotencyStore,
  migrateTursoAdapter,
  verifyTursoAdapterSchema,
} from "./index";
import {
  hasLiveTurso,
  isRemoteTursoUrl,
  TURSO_AUTH_TOKEN,
  TURSO_DATABASE_URL,
  uniqueTablePrefix,
} from "./test-utils/turso-env";

function assertSuiteOk(report: StoreConformanceReport): void {
  expect(
    report.ok,
    JSON.stringify(
      report.results.filter((r) => !r.ok),
      null,
      2,
    ),
  ).toBe(true);
}

describe("serverless live (skip-clean without TURSO_DATABASE_URL)", () => {
  it("documents clean skip when remote env unset", () => {
    if (!hasLiveTurso() || !isRemoteTursoUrl()) {
      expect(TURSO_DATABASE_URL === undefined || !isRemoteTursoUrl()).toBe(true);
      return;
    }
    // Live env present — remaining tests exercise it.
    expect(hasLiveTurso()).toBe(true);
  });

  it(
    "migrate + verify + idempotency smoke when remote available",
    async () => {
      if (!hasLiveTurso() || !isRemoteTursoUrl()) {
        return;
      }
      let openOk = false;
      try {
        const { connect } = await import("@tursodatabase/serverless");
        const cfg: { url: string; authToken?: string } = {
          url: TURSO_DATABASE_URL!,
        };
        if (TURSO_AUTH_TOKEN) cfg.authToken = TURSO_AUTH_TOKEN;
        const conn = connect(cfg);
        openOk = true;
        const { createTursoServerlessStores, createTursoServerlessExecutor } =
          await import("./drivers/serverless");
        const executor = createTursoServerlessExecutor(conn);
        const prefix = uniqueTablePrefix("ss");
        await migrateTursoAdapter(executor, { namespace: { tablePrefix: prefix } });
        const verify = await verifyTursoAdapterSchema(executor, {
          namespace: { tablePrefix: prefix },
        });
        expect(verify.ok, JSON.stringify(verify)).toBe(true);

        const clock = createFakeClock({ initialMs: Date.now() });
        const stores = createTursoServerlessStores({
          client: conn,
          clock,
          namespace: { tablePrefix: prefix },
        });
        const r = await stores.idempotency.reserve({
          key: `smoke-${Date.now()}`,
          fingerprint: "fp",
          owner: "serverless-smoke",
          leaseMs: 15_000,
        });
        expect(r.kind).toBe("acquired");
        if (r.kind === "acquired") {
          const got = await stores.idempotency.get(r.record.key);
          expect(got?.leaseToken).toBe(r.leaseToken);
          await stores.idempotency.complete({
            key: r.record.key,
            leaseToken: r.leaseToken,
            result: { ok: true },
          });
        }
        await conn.close?.();
      } catch (err) {
        if (openOk) throw err;
        return;
      }
    },
    { timeout: 60_000 },
  );

  // Full remote conformance needs well above bun's default 5s timeout.
  it(
    "idempotency conformance suite when remote available",
    async () => {
      if (!hasLiveTurso() || !isRemoteTursoUrl()) {
        return;
      }
      let openOk = false;
      try {
        const { connect } = await import("@tursodatabase/serverless");
        const cfg: { url: string; authToken?: string } = {
          url: TURSO_DATABASE_URL!,
        };
        if (TURSO_AUTH_TOKEN) cfg.authToken = TURSO_AUTH_TOKEN;
        const conn = connect(cfg);
        openOk = true;
        const { createTursoServerlessExecutor } = await import(
          "./drivers/serverless"
        );
        const executor = createTursoServerlessExecutor(conn);
        const prefix = uniqueTablePrefix("sc");
        await migrateTursoAdapter(executor, { namespace: { tablePrefix: prefix } });

        const report = await runIdempotencyStoreConformanceSuite({
          name: "serverless-live-idempotency",
          createStore: async ({ clock }) =>
            createTursoIdempotencyStore({
              executor,
              clock,
              namespace: { tablePrefix: prefix },
            }),
          createClock: () => createFakeClock(),
        });
        assertSuiteOk(report);
        await conn.close?.();
      } catch (err) {
        if (openOk) throw err;
        return;
      }
    },
    { timeout: 180_000 },
  );
});
