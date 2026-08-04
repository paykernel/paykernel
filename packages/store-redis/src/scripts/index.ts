/**
 * Script registry + load/eval helpers for Redis stores.
 */

import {
  IDEMPOTENCY_COMPLETE_LUA,
  IDEMPOTENCY_DELETE_IF_EXPIRED_LUA,
  IDEMPOTENCY_GET_LUA,
  IDEMPOTENCY_MARK_INDETERMINATE_LUA,
  IDEMPOTENCY_RENEW_LUA,
  IDEMPOTENCY_RESERVE_LUA,
} from "./idempotency.lua";
import {
  RECON_CLAIM_LUA,
  RECON_COMPLETE_LUA,
  RECON_DELETE_IF_EXPIRED_LUA,
  RECON_FAIL_LUA,
  RECON_GET_LUA,
  RECON_MARK_MANUAL_REVIEW_LUA,
  RECON_RENEW_LUA,
  RECON_SCHEDULE_LUA,
} from "./reconciliation.lua";
import {
  WEBHOOK_CLAIM_LUA,
  WEBHOOK_COMPLETE_LUA,
  WEBHOOK_DELETE_IF_EXPIRED_LUA,
  WEBHOOK_FAIL_LUA,
  WEBHOOK_GET_LUA,
  WEBHOOK_RENEW_LUA,
} from "./webhook-inbox.lua";

export {
  IDEMPOTENCY_RESERVE_LUA,
  IDEMPOTENCY_RENEW_LUA,
  IDEMPOTENCY_COMPLETE_LUA,
  IDEMPOTENCY_MARK_INDETERMINATE_LUA,
  IDEMPOTENCY_GET_LUA,
  IDEMPOTENCY_DELETE_IF_EXPIRED_LUA,
} from "./idempotency.lua";

export {
  WEBHOOK_CLAIM_LUA,
  WEBHOOK_RENEW_LUA,
  WEBHOOK_COMPLETE_LUA,
  WEBHOOK_FAIL_LUA,
  WEBHOOK_GET_LUA,
  WEBHOOK_DELETE_IF_EXPIRED_LUA,
} from "./webhook-inbox.lua";

export {
  RECON_SCHEDULE_LUA,
  RECON_CLAIM_LUA,
  RECON_RENEW_LUA,
  RECON_COMPLETE_LUA,
  RECON_FAIL_LUA,
  RECON_MARK_MANUAL_REVIEW_LUA,
  RECON_GET_LUA,
  RECON_DELETE_IF_EXPIRED_LUA,
} from "./reconciliation.lua";

export {
  parseTaggedResult,
  parseIdempotencyRecord,
  parseWebhookRecord,
  parseReconciliationRecord,
  splitRecordAndToken,
  IDEMPOTENCY_PACK_LEN,
  WEBHOOK_PACK_LEN,
  RECON_PACK_LEN,
} from "./results";

/** Named registry of all correctness-critical scripts. */
export const REDIS_SCRIPT_REGISTRY = {
  idempotency: {
    reserve: IDEMPOTENCY_RESERVE_LUA,
    renew: IDEMPOTENCY_RENEW_LUA,
    complete: IDEMPOTENCY_COMPLETE_LUA,
    markIndeterminate: IDEMPOTENCY_MARK_INDETERMINATE_LUA,
    get: IDEMPOTENCY_GET_LUA,
    deleteIfExpired: IDEMPOTENCY_DELETE_IF_EXPIRED_LUA,
  },
  webhookInbox: {
    claim: WEBHOOK_CLAIM_LUA,
    renew: WEBHOOK_RENEW_LUA,
    complete: WEBHOOK_COMPLETE_LUA,
    fail: WEBHOOK_FAIL_LUA,
    get: WEBHOOK_GET_LUA,
    deleteIfExpired: WEBHOOK_DELETE_IF_EXPIRED_LUA,
  },
  reconciliation: {
    schedule: RECON_SCHEDULE_LUA,
    claim: RECON_CLAIM_LUA,
    renew: RECON_RENEW_LUA,
    complete: RECON_COMPLETE_LUA,
    fail: RECON_FAIL_LUA,
    markManualReview: RECON_MARK_MANUAL_REVIEW_LUA,
    get: RECON_GET_LUA,
    deleteIfExpired: RECON_DELETE_IF_EXPIRED_LUA,
  },
} as const;

export type RedisScriptRegistry = typeof REDIS_SCRIPT_REGISTRY;
