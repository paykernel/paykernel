import { describe, expect, it } from "bun:test";
import {
  buildFoundationMigrationSql,
  INDEX_LABEL_MAX,
  indexLabel,
} from "./definitions";
import { MAX_SAFE_TABLE_PREFIX_LENGTH } from "../schema/namespace";

function extractIndexNames(sql: string): string[] {
  const names: string[] = [];
  const re = /CREATE INDEX IF NOT EXISTS (idx_[A-Za-z0-9_]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    names.push(m[1]!);
  }
  return names;
}

describe("indexLabel", () => {
  it("passes short names through unchanged", () => {
    expect(indexLabel('"payment_idempotency"')).toBe("payment_idempotency");
    expect(indexLabel("payment_webhook_inbox")).toBe("payment_webhook_inbox");
  });

  it("truncates from the end so long shared prefixes stay distinct", () => {
    // Max-safe prefix + "payment_*" tables: start-truncation collides; end-keep does not.
    const prefix = "p".repeat(MAX_SAFE_TABLE_PREFIX_LENGTH);
    const idem = `${prefix}payment_idempotency`;
    const inbox = `${prefix}payment_webhook_inbox`;
    const recon = `${prefix}payment_reconciliation_jobs`;

    expect(idem.length).toBeGreaterThan(INDEX_LABEL_MAX);

    const a = indexLabel(idem);
    const b = indexLabel(inbox);
    const c = indexLabel(recon);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
    expect(a.length).toBe(INDEX_LABEL_MAX);
    expect(a.endsWith("payment_idempotency")).toBe(true);
    expect(c.endsWith("payment_reconciliation_jobs")).toBe(true);
  });

  it("strips quotes and schema dots before labeling", () => {
    expect(indexLabel('"payments"."pay_payment_idempotency"')).toBe(
      "payments_pay_payment_idempotency",
    );
  });
});

describe("buildFoundationMigrationSql index uniqueness", () => {
  it("emits unique index names for short (default) qualify", () => {
    const sql = buildFoundationMigrationSql("sqlite", (logical) => `"${logical}"`);
    const names = extractIndexNames(sql);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it("long max-safe prefix keeps per-table index names distinct", () => {
    const prefix = "p".repeat(MAX_SAFE_TABLE_PREFIX_LENGTH);
    const sql = buildFoundationMigrationSql("postgres", (logical) => `"${prefix}${logical}"`);
    const names = extractIndexNames(sql);
    expect(names.length).toBeGreaterThanOrEqual(16); // 3 + 7 + 6 domain indexes
    expect(new Set(names).size).toBe(names.length);

    // Shared-suffix indexes must not collapse across tables.
    const leaseIndexes = names.filter((n) => n.endsWith("_lease_expires"));
    expect(leaseIndexes.length).toBe(3);
    expect(new Set(leaseIndexes).size).toBe(3);

    const statusIndexes = names.filter((n) => n.endsWith("_status"));
    expect(statusIndexes.length).toBe(3);
    expect(new Set(statusIndexes).size).toBe(3);

    expect(names.some((n) => n.endsWith("_st_avail"))).toBe(true);
    expect(names.some((n) => n.endsWith("_st_due"))).toBe(true);
    expect(names.filter((n) => n.endsWith("_st_lexp")).length).toBe(2);
  });

  it("schema-qualified long names remain unique", () => {
    const prefix = "x".repeat(30);
    const sql = buildFoundationMigrationSql(
      "postgres",
      (logical) => `"payments"."${prefix}${logical}"`,
    );
    const names = extractIndexNames(sql);
    expect(new Set(names).size).toBe(names.length);
  });
});
