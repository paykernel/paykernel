/**
 * Dialect identifiers for claim SQL and migration DDL.
 *
 * Do not pretend PostgreSQL and SQLite share identical syntax —
 * share intent; dialectize templates.
 */

export type DialectId = "postgres" | "sqlite" | "generic";

export const DIALECTS: readonly DialectId[] = ["postgres", "sqlite", "generic"] as const;

export function isDialectId(value: unknown): value is DialectId {
  return value === "postgres" || value === "sqlite" || value === "generic";
}

export function assertDialectId(value: unknown): DialectId {
  if (!isDialectId(value)) {
    throw new Error(`unsupported dialect: ${String(value)}`);
  }
  return value;
}
