// file: packages/core/src/runtime/index.ts

/**
 * Phase 8 — portable runtime surface (PaymentRuntime, crypto helpers, clock).
 *
 * @see docs/runtime.md
 */

export type { Clock } from "./clock";
export { systemClock } from "./clock";

export type { CryptoProvider } from "./crypto-provider";
export {
  resolveDefaultCrypto,
  uuidV4FromGetRandomValues,
} from "./crypto-provider";

export type { PaymentRuntime, GatewayRuntimeDeps } from "./payment-runtime";
export {
  createPaymentRuntime,
  mergePaymentRuntime,
  paymentRuntimeFromContext,
} from "./payment-runtime";

export type { TimeoutSignalHandle } from "./abort";
export {
  combineAbortSignals,
  createTimeoutSignal,
  isAbortError,
  mapHttpAbortError,
  extractAbortSignal,
  stripAbortSignal,
  withAbortSignal,
} from "./abort";

// Phase 20 — OperationContext for diagnostics / telemetry
export type {
  PaymentOperationType,
  OperationContext,
  CreateOperationContextInput,
  FinalizeOperationContextPatch,
} from "./operation-context";
export {
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
} from "./operation-context";

export {
  utf8Encode,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  utf8ToBase64,
  timingSafeEqualBytes,
  timingSafeEqualHex,
  sha256,
  sha256Hex,
  sha512,
  sha512Hex,
  hmacSha256,
  hmacSha256Hex,
  hmacSha512,
  hmacSha512Hex,
  concatBytes,
} from "./crypto-portable";
