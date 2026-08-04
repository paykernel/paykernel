import { describe, expect, it } from "bun:test";
import {
  createSchemaNamespace,
  resolveTableName,
  resolveUnqualifiedTableName,
  SchemaNamespaceError,
  validateIdentifier,
  validateTablePrefix,
  quoteIdentifier,
} from "./namespace";
import { LOGICAL_TABLES } from "./tables";

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
