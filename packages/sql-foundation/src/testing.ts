/**
 * Test-only helpers. Do not import from production next to migrate().
 *
 * `createFakeExecutor` always reports success and never applies durable schema.
 */
export {
  createFakeDbState,
  createFakeExecutor,
  expectedTablesForNamespace,
  sampleIdempotencyRecord,
  sampleWebhookRecord,
  sampleReconciliationRecord,
  DIALECT_SAMPLES,
} from "./fixtures/migration-fixtures";
export type { FakeDbState, DialectSample } from "./fixtures/migration-fixtures";
