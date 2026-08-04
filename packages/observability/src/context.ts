/**
 * Re-export OperationContext builders from core.
 * Single source of truth remains `@paykernel/core`.
 * Redacting telemetry helpers live in `./redaction` (same core `redact` model).
 */

export type {
  OperationContext,
  CreateOperationContextInput,
  FinalizeOperationContextPatch,
  PaymentOperationType,
  Clock,
} from "@paykernel/core";

export {
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
  systemClock,
} from "@paykernel/core";
