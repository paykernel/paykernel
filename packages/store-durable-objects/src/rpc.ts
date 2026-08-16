/**
 * Required Durable Object stub RPC methods.
 *
 * Worker wrappers (`extends DurableObject`) must forward every name here
 * onto {@link PaymentsStoreObject}. Hash sharding additionally needs
 * `bindHashPartitionLayout` (DO-1 layout seal) — do not omit the next
 * layout/meta method when one is added; extend this list.
 */

/** Store claim/list/cleanup RPCs (all sharding kinds). */
export const REQUIRED_DO_STORE_RPC_METHODS = [
  "reserveIdempotency",
  "renewIdempotency",
  "completeIdempotency",
  "markIdempotencyIndeterminate",
  "getIdempotency",
  "deleteExpiredIdempotency",
  "claimWebhook",
  "renewWebhook",
  "completeWebhook",
  "failWebhook",
  "getWebhook",
  "peekRetryableWebhooks",
  "listRetryableWebhooks",
  "deleteExpiredWebhooks",
  "scheduleReconciliation",
  "claimReconciliation",
  "renewReconciliation",
  "completeReconciliation",
  "failReconciliation",
  "markReconciliationManualReview",
  "getReconciliation",
  "peekDueReconciliation",
  "listDueReconciliation",
  "deleteExpiredReconciliation",
] as const;

/**
 * Extra RPCs required for `kind: "hash"` (DO-1).
 * First writer seals `partitions` on the layout meta object.
 */
export const REQUIRED_DO_HASH_RPC_METHODS = [
  "bindHashPartitionLayout",
] as const;

/** Full required RPC surface: store methods + hash layout seal. */
export const REQUIRED_DO_RPC_METHODS = [
  ...REQUIRED_DO_HASH_RPC_METHODS,
  ...REQUIRED_DO_STORE_RPC_METHODS,
] as const;

export type RequiredDoRpcMethod = (typeof REQUIRED_DO_RPC_METHODS)[number];
