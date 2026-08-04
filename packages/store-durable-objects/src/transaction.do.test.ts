/**
 * transactionSync rollback: throw aborts partial writes.
 * Forbid BEGIN/COMMIT via sql.exec.
 * External-work-outside-txn invariant (static + runtime).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createDoExecutor,
  migrateDoAdapter,
  createDoIdempotencyStore,
} from "./index";
import { createMockDoSql } from "./test-utils/mock-do-sql";
import { uniqueTablePrefix } from "./test-utils/do-env";

const SRC_ROOT = join(import.meta.dir);

function walkProductionTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "test-utils" || name.endsWith(".test.ts")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkProductionTs(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("do transactionSync", () => {
  it("throw inside transactionSync rolls back partial writes", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("tx");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });

      // sql-store logical table + prefix (see resolveTableName)
      const table = `"${prefix}payment_idempotency"`;
      expect(() => {
        executor.transaction(() => {
          executor.run(
            `INSERT INTO ${table} (
              key, status, fingerprint, attempts, generation, created_at, updated_at
            ) VALUES (?, 'reserved', 'fp', 1, 1, ?, ?)`,
            ["rollback-key", new Date().toISOString(), new Date().toISOString()],
          );
          throw new Error("force_rollback");
        });
      }).toThrow("force_rollback");

      const rows = executor.query(
        `SELECT key FROM ${table} WHERE key = ?`,
        ["rollback-key"],
      );
      expect(rows.length).toBe(0);
    } finally {
      handle.close();
    }
  });

  it("forbids BEGIN/COMMIT via sql.exec", () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      expect(() => executor.run("BEGIN IMMEDIATE")).toThrow(/forbidden/i);
      expect(() => executor.run("COMMIT")).toThrow(/forbidden/i);
    } finally {
      handle.close();
    }
  });

  it("rejects Promise return from transactionSync callback", () => {
    const handle = createMockDoSql();
    try {
      expect(() => {
        handle.storage.transactionSync(() => {
          return Promise.resolve(1) as unknown as number;
        });
      }).toThrow(/synchronous/i);
    } finally {
      handle.close();
    }
  });

  it("cursor fully consumed: query returns array not live cursor", async () => {
    const handle = createMockDoSql();
    try {
      const executor = createDoExecutor(handle.storage);
      const prefix = uniqueTablePrefix("cu");
      await migrateDoAdapter(executor, { namespace: { tablePrefix: prefix } });
      const store = createDoIdempotencyStore({
        executor,
        namespace: { tablePrefix: prefix },
      });
      await store.reserve({
        key: "c1",
        fingerprint: "fp",
        owner: "w",
        leaseMs: 5000,
      });
      // After query, further SQL must not depend on open cursor
      const got = await store.get("c1");
      expect(got?.key).toBe("c1");
    } finally {
      handle.close();
    }
  });

  it("external-work-outside-txn: no await inside transactionSync callback bodies", () => {
    // Static invariant for matrix 17.5 item 10 / roadmap §28:
    // claim/complete must not await network inside transactionSync.
    const files = walkProductionTs(SRC_ROOT);
    const violations: string[] = [];

    // Match transactionSync(… => { … }) and look for await in the callback body.
    // Also catch .transaction(() => { … await … }) on DoExecutor.
    const callRe =
      /\.(?:transactionSync|transaction)\s*(?:<[^>]*>)?\s*\(\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*\{/g;

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Strip block comments and line comments to avoid false positives in docs.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      callRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = callRe.exec(stripped)) !== null) {
        const start = m.index + m[0].length;
        // Walk braced body (naive brace depth).
        let depth = 1;
        let i = start;
        for (; i < stripped.length && depth > 0; i++) {
          const ch = stripped[i];
          if (ch === "{") depth += 1;
          else if (ch === "}") depth -= 1;
        }
        const body = stripped.slice(start, i - 1);
        if (/\bawait\b/.test(body) || /\bfetch\s*\(/.test(body)) {
          violations.push(`${file}: await/fetch inside transaction callback`);
        }
        // Async arrow on transactionSync is itself a violation.
        if (/transactionSync\s*(?:<[^>]*>)?\s*\(\s*async\s/.test(m[0])) {
          violations.push(`${file}: async callback passed to transactionSync`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("store claim methods use sync SQL (no network I/O in claim paths)", () => {
    // Claim SQL paths must not await provider network inside the store.
    // Pattern: claim → leave txn → external work (caller) → complete with lease.
    for (const rel of [
      "stores/idempotency-store.ts",
      "stores/webhook-inbox-store.ts",
      "stores/reconciliation-store.ts",
      "object/payments-store-object.ts",
      "object/alarm-scheduler.ts",
    ]) {
      const src = readFileSync(join(SRC_ROOT, rel), "utf8");
      // No fetch / http to providers inside store claim / alarm SQL paths.
      expect(src, rel).not.toMatch(/\bfetch\s*\(/);
      expect(src, rel).not.toMatch(/https?:\/\//);
      // Claims use sync executor.query / sql.exec — not get-then-set without RETURNING.
      if (rel.startsWith("stores/")) {
        expect(src, rel).toMatch(/RETURNING/i);
        expect(src, rel).toMatch(/withMappedErrors/);
      }
    }
    // Documented external-work-outside-txn pattern on object façade + idempotency.
    const façade = readFileSync(
      join(SRC_ROOT, "object/payments-store-object.ts"),
      "utf8",
    );
    expect(façade.toLowerCase()).toMatch(/external/);
    const idemp = readFileSync(
      join(SRC_ROOT, "stores/idempotency-store.ts"),
      "utf8",
    );
    expect(idemp.toLowerCase()).toMatch(/external/);
  });
});
