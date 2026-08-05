import { describe, expect, it } from "bun:test";
import {
  createSchemaNamespace,
  LONGEST_LOGICAL_TABLE_NAME_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  MAX_SAFE_TABLE_PREFIX_LENGTH,
  resolveTableName,
  resolveUnqualifiedTableName,
  SchemaNamespaceError,
  validateIdentifier,
  validateTablePrefix,
  quoteIdentifier,
} from "./namespace";
import { ALL_LOGICAL_TABLES, LOGICAL_TABLES } from "./tables";

describe("SchemaNamespaceConfig validation", () => {
  it("accepts empty config (defaults)", () => {
    const ns = createSchemaNamespace({});
    expect(ns.tablePrefix).toBe("");
    expect(ns.sqlSchema).toBeUndefined();
    expect(ns.tenantColumnEnabled).toBe(false);
  });

  it("accepts valid prefix, schema, tenant column", () => {
    const ns = createSchemaNamespace({
      tablePrefix: "pay_",
      sqlSchema: "payments",
      tenantColumn: true,
    });
    expect(ns.tablePrefix).toBe("pay_");
    expect(ns.sqlSchema).toBe("payments");
    expect(ns.tenantColumnEnabled).toBe(true);
    expect(ns.tenantColumnName).toBe("tenant_id");
  });

  it("accepts custom tenant column name", () => {
    const ns = createSchemaNamespace({ tenantColumn: "org_id" });
    expect(ns.tenantColumnEnabled).toBe(true);
    expect(ns.tenantColumnName).toBe("org_id");
  });

  it("rejects empty tablePrefix", () => {
    expect(() => createSchemaNamespace({ tablePrefix: "" })).toThrow(SchemaNamespaceError);
  });

  it("rejects empty sqlSchema", () => {
    expect(() => createSchemaNamespace({ sqlSchema: "" })).toThrow(SchemaNamespaceError);
  });

  it("rejects SQL injection attempts in tablePrefix", () => {
    const attacks = [
      "pay_; DROP TABLE",
      'pay_"',
      "pay_'",
      "pay_.x",
      "pay_--",
      "pay_/*",
      "pay_ space",
    ];
    for (const tablePrefix of attacks) {
      expect(() => createSchemaNamespace({ tablePrefix })).toThrow(SchemaNamespaceError);
    }
  });

  it("rejects injection in sqlSchema", () => {
    const attacks = ["payments;drop", 'pay"ments', "pay.ments", "public--", "a b"];
    for (const sqlSchema of attacks) {
      expect(() => createSchemaNamespace({ sqlSchema })).toThrow(SchemaNamespaceError);
    }
  });

  it("rejects over-long identifiers", () => {
    const long = "a".repeat(64);
    expect(() => createSchemaNamespace({ sqlSchema: long })).toThrow(SchemaNamespaceError);
    expect(() => validateTablePrefix(long)).toThrow(SchemaNamespaceError);
  });

  it("validateIdentifier rejects invalid starts", () => {
    expect(() => validateIdentifier("1abc", "x")).toThrow(SchemaNamespaceError);
    expect(() => validateIdentifier("-abc", "x")).toThrow(SchemaNamespaceError);
  });

  it("safe max prefix is 63 minus longest logical table (payment_reconciliation_jobs=27)", () => {
    expect(LOGICAL_TABLES.reconciliationJobs.length).toBe(27);
    expect(LOGICAL_TABLES.idempotency.length).toBe(19);
    expect(LONGEST_LOGICAL_TABLE_NAME_LENGTH).toBe(27);
    expect(MAX_SAFE_TABLE_PREFIX_LENGTH).toBe(MAX_IDENTIFIER_LENGTH - 27);
    expect(MAX_SAFE_TABLE_PREFIX_LENGTH).toBe(36);
  });

  it("rejects prefix that fits short tables but exceeds longest logical table", () => {
    // Regression: sampling only payment_idempotency accepted prefixes that later
    // failed resolveUnqualifiedTableName for payment_reconciliation_jobs.
    const prefix = "p".repeat(37);
    expect(prefix.length + LOGICAL_TABLES.idempotency.length).toBeLessThanOrEqual(
      MAX_IDENTIFIER_LENGTH,
    );
    expect(prefix.length + LOGICAL_TABLES.reconciliationJobs.length).toBeGreaterThan(
      MAX_IDENTIFIER_LENGTH,
    );
    expect(() => validateTablePrefix(prefix)).toThrow(SchemaNamespaceError);
    expect(() => createSchemaNamespace({ tablePrefix: prefix })).toThrow(SchemaNamespaceError);
    // Upper edge of the old undersampled band
    expect(() => validateTablePrefix("x".repeat(44))).toThrow(SchemaNamespaceError);
  });

  it("accepts max safe prefix and resolves every logical table", () => {
    const prefix = "a".repeat(MAX_SAFE_TABLE_PREFIX_LENGTH);
    expect(validateTablePrefix(prefix)).toBe(prefix);
    const ns = createSchemaNamespace({ tablePrefix: prefix });
    for (const logical of ALL_LOGICAL_TABLES) {
      const physical = resolveUnqualifiedTableName(logical, ns);
      expect(physical.length).toBeLessThanOrEqual(MAX_IDENTIFIER_LENGTH);
      expect(physical).toBe(`${prefix}${logical}`);
    }
    expect(
      resolveUnqualifiedTableName(LOGICAL_TABLES.reconciliationJobs, ns).length,
    ).toBe(MAX_IDENTIFIER_LENGTH);
  });
});

describe("resolveTableName", () => {
  it("returns quoted logical name without prefix", () => {
    const name = resolveTableName(LOGICAL_TABLES.idempotency, {});
    expect(name).toBe('"payment_idempotency"');
  });

  it("applies tablePrefix", () => {
    const ns = createSchemaNamespace({ tablePrefix: "pay_" });
    expect(resolveUnqualifiedTableName(LOGICAL_TABLES.webhookInbox, ns)).toBe(
      "pay_payment_webhook_inbox",
    );
    expect(resolveTableName(LOGICAL_TABLES.webhookInbox, ns)).toBe('"pay_payment_webhook_inbox"');
  });

  it("qualifies with PostgreSQL schema", () => {
    const ns = createSchemaNamespace({
      tablePrefix: "pay_",
      sqlSchema: "payments",
    });
    expect(resolveTableName(LOGICAL_TABLES.reconciliationJobs, ns)).toBe(
      '"payments"."pay_payment_reconciliation_jobs"',
    );
  });

  it("is stable across repeated calls", () => {
    const ns = createSchemaNamespace({ tablePrefix: "x_", sqlSchema: "s" });
    const a = resolveTableName(LOGICAL_TABLES.storageMigrations, ns);
    const b = resolveTableName(LOGICAL_TABLES.storageMigrations, ns);
    expect(a).toBe(b);
  });

  it("quoteIdentifier wraps validated names", () => {
    expect(quoteIdentifier("tenant_id")).toBe('"tenant_id"');
    expect(() => quoteIdentifier("bad-name")).toThrow(SchemaNamespaceError);
  });
});
