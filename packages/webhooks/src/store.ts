/**
 * Webhook inbox store contract (Phase 10 — domain ownership).
 *
 * Roadmap §3.4 / §9.1: atomic claim, lease-token fencing, generation rotation.
 * **Contract ownership (Phase 10):** this package owns the engine-facing
 * `WebhookInboxStore`. Phase 9 testkit keeps a dual structural copy for
 * conformance + `createMemoryWebhookInboxStore`. Bidirectional assignability is
 * frozen in testkit `engine-memory-integration.test.ts` so contract drift fails CI.
 * `createMemoryWebhookInboxStore` remains assignable to this interface.
 *
 * Durable adapters MUST pass `runWebhookInboxStoreConformanceSuite` (still in
 * testkit). This package does NOT import testkit.
 *
 * ### Atomicity
 * `claim` MUST be a single atomic engine-level claim (not get-then-set races).
 *
 * ### Secrets
 * Never store raw signatures, authorization headers, secret tokens, or
 * unredacted provider payloads. `lastError` must be sanitized. `payloadRef`
 * is an optional opaque/redacted snapshot only.
 *
 * ### 10.2 field mapping (lean Phase 9 record)
 * | Roadmap 10.2 concept        | Lean record field                          |
 * | --------------------------- | ------------------------------------------ |
 * | event key                   | `key`                                      |
 * | gateway + provider event id | encoded in `key` via `deriveWebhookEventKey` |
 * | provider event type         | optional in `payloadRef` envelope JSON     |
 * | schema version              | optional in `payloadRef` envelope JSON     |
 * | normalized envelope         | `payloadRef` (sanitized JSON string only)  |
 * | payload hash                | `payloadHash`                              |
 * | state                       | `status`                                   |
 * | attempt count               | `attempts`                                 |
 * | lease owner / token / expiry| `leaseOwner` / `leaseToken` / `leaseExpiresAt` |
 * | first received              | `createdAt`                                |
 * | last received / updated     | `updatedAt`                                |
 * | next attempt (claim gate)   | `availableAt`                              |
 * | completion timestamp        | `updatedAt` when `status === "completed"`  |
 * | sanitized last error        | `lastError`                                |
 *
 * Adapters MAY extend rows with first-class gateway/provider fields later
 * without breaking this lean contract (additive columns).
 */

// ─── Shared primitives ───────────────────────────────────────────────────────

/** Opaque webhook event key (typically `gateway:providerEventId`). */
export type WebhookEventKey = string;

/** Unguessable lease / fencing token (opaque string). */
export type LeaseToken = string;

/** ISO-8601 timestamp string (portable). */
export type IsoTimestamp = string;

export type CleanupInput = {
  before: IsoTimestamp;
  limit?: number;
};

export type CleanupResult = {
  deleted: number;
};

export type WithTransaction = {
  withTransaction?<T>(fn: () => Promise<T> | T): Promise<T>;
};

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Lease token stale/wrong/expired, or key missing for a fenced mutation.
 * Callers should treat this as "another worker owns the work" — not as a
 * definitive business failure of the payment itself.
 *
 * Portable copy owned by webhooks so the engine never imports testkit.
 * Structurally/behaviorally aligned with testkit `StoreLeaseLostError`
 * (`code: "lease_lost"`, `name: "StoreLeaseLostError"`).
 */
export class StoreLeaseLostError extends Error {
  readonly code = "lease_lost" as const;
  readonly retryable = false;

  constructor(message = "Lease lost or fencing token rejected", cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "StoreLeaseLostError";
  }
}

/**
 * True when `error` is a lease/fencing rejection (this package's class, or any
 * Error with `name === "StoreLeaseLostError"` / `code === "lease_lost"`).
 */
export function isStoreLeaseLostError(error: unknown): boolean {
  if (error instanceof StoreLeaseLostError) return true;
  if (error instanceof Error && error.name === "StoreLeaseLostError") return true;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "lease_lost"
  ) {
    return true;
  }
  return false;
}

// ─── Webhook inbox ───────────────────────────────────────────────────────────

export type WebhookInboxStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed"
  | "dead_letter";

/**
 * Webhook inbox row (claimable). Lean Phase 9 shape — see module header for 10.2 mapping.
 *
 * `payloadRef` is optional and must not be a raw secret payload.
 */
export type WebhookInboxRecord = {
  key: WebhookEventKey;
  status: WebhookInboxStatus;
  /** Hash of payload body for duplicate detection with different body. */
  payloadHash: string;
  /**
   * Optional redacted/minimal payload snapshot for retries.
   * Implementations must NOT store raw secrets by default.
   */
  payloadRef?: string | undefined;
  leaseOwner?: string | undefined;
  leaseToken?: LeaseToken | undefined;
  leaseExpiresAt?: IsoTimestamp | undefined;
  /**
   * Claim/handler attempt count. Each successful `claim` acquire increments by 1
   * unless a subsequent `fail({ restoreAttempt: true })` undoes the parking claim
   * (engine `ackAfterClaim` path). Engine `maxAttempts` is max **handler** attempts.
   */
  attempts: number;
  lastError?: string | undefined;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /**
   * Earliest time a key-addressed `claim` may reacquire a **pending** row
   * (true backoff). Also filters `listRetryable`. Set by `fail(retryAfterMs)`.
   */
  availableAt: IsoTimestamp;
  /** Monotonic generation; increments on successful claim/renew. */
  generation: number;
};

export type ClaimWebhookInput = {
  key: WebhookEventKey;
  payloadHash: string;
  owner: string;
  leaseMs: number;
  /** Optional opaque reference (not raw secret payload). */
  payloadRef?: string;
};

/**
 * Result of an atomic claim attempt.
 *
 * - `acquired` — caller holds the lease; run handler or park
 * - `already_completed` / `duplicate_failed` — terminal; do not re-run
 * - `in_progress` — active lease held by another worker
 * - `payload_hash_conflict` — same key, different body hash
 * - `not_available` — pending but `availableAt` is still in the future (backoff);
 *   must **not** increment attempts; engine maps to `scheduled_for_retry`
 */
export type ClaimWebhookResult =
  | { kind: "acquired"; record: WebhookInboxRecord; leaseToken: LeaseToken }
  | { kind: "already_completed"; record: WebhookInboxRecord }
  | { kind: "in_progress"; record: WebhookInboxRecord }
  | { kind: "payload_hash_conflict"; record: WebhookInboxRecord }
  | { kind: "duplicate_failed"; record: WebhookInboxRecord }
  | {
      kind: "not_available";
      record: WebhookInboxRecord;
      /** Echo of `record.availableAt` (when the row becomes claimable). */
      availableAt: IsoTimestamp;
    };

export type RenewWebhookLeaseInput = {
  key: WebhookEventKey;
  /** Active lease token. Stale → `{ ok: false, reason: "lease_lost" }`. */
  leaseToken: LeaseToken;
  leaseMs: number;
};

/**
 * Successful renew MUST rotate `leaseToken` and increment `generation`.
 * Pre-renew token MUST fail subsequent complete/fail/renew.
 */
export type RenewWebhookLeaseResult =
  | { ok: true; record: WebhookInboxRecord; leaseToken: LeaseToken }
  | { ok: false; reason: "lease_lost" | "not_found" | "wrong_status" };

export type CompleteWebhookInput = {
  key: WebhookEventKey;
  /** Required active lease token. Wrong/stale/expired → {@link StoreLeaseLostError}. */
  leaseToken: LeaseToken;
};

export type FailWebhookInput = {
  key: WebhookEventKey;
  /** Required active lease token. Wrong/stale/expired → {@link StoreLeaseLostError}. */
  leaseToken: LeaseToken;
  /** Sanitized error code/message only — never secrets or raw payloads. */
  error: string;
  /** When true, mark dead_letter; otherwise leave retryable (pending after lease). */
  deadLetter?: boolean;
  /**
   * Delay before the row is claimable again (ms). Sets `availableAt = now + retryAfterMs`.
   * Applies to **both** key-addressed `claim` and `listRetryable` (true backoff).
   * Default: immediate availability (`0`).
   */
  retryAfterMs?: number;
  /**
   * When true, decrement `attempts` by 1 (floor 0) after this fail.
   * Engine uses this for non-handler releases (`ackAfterClaim` parking) so the
   * parking claim does not consume the `maxAttempts` **handler** budget.
   * Adapters MUST treat `undefined` as false.
   */
  restoreAttempt?: boolean;
};

export type ListRetryableInput = {
  now?: IsoTimestamp;
  limit?: number;
};

/**
 * Atomic webhook inbox claim store.
 *
 * ### Atomicity
 * `claim` MUST be a single atomic engine-level claim. Not get-then-set races.
 *
 * ### Lease-gated mutators
 * After acquire, `renew` / `complete` / `fail` **require the active `leaseToken`**.
 * Wrong/stale/expired → {@link StoreLeaseLostError} or renew `lease_lost`.
 * After lease reclaim, the old token MUST fail.
 *
 * Same event key: second claim with same payload hash while in-progress → in_progress;
 * completed → already_completed; different hash → payload_hash_conflict;
 * dead_letter/failed → duplicate_failed;
 * pending with `availableAt` in the future → `not_available` (no acquire, no attempt++);
 * expired lease may be re-acquired with a new fencing token (generation++).
 */
export interface WebhookInboxStore extends WithTransaction {
  /**
   * Atomic claim (or re-claim after lease expiry / due availableAt).
   * Increments `generation` and issues a new unguessable `leaseToken` on acquire.
   * MUST NOT acquire a pending row whose `availableAt` is still in the future —
   * return `{ kind: "not_available", ... }` instead (no attempt increment).
   */
  claim(input: ClaimWebhookInput): Promise<ClaimWebhookResult>;

  /**
   * Extend an active lease. **Requires active `leaseToken`.**
   * On success: rotates token, increments generation; pre-renew token is invalid.
   */
  renew(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult>;

  /**
   * Mark event processing complete (terminal).
   * **Requires active `leaseToken`.** Stale/wrong/expired → {@link StoreLeaseLostError}.
   */
  complete(input: CompleteWebhookInput): Promise<void>;

  /**
   * Record sanitized failure; optionally dead-letter or schedule retry.
   * **Requires active `leaseToken`.** Stale/wrong → {@link StoreLeaseLostError}.
   * Sets `availableAt` from `retryAfterMs` (claim gate + list filter).
   * When `restoreAttempt: true`, decrements `attempts` by 1 (floor 0).
   */
  fail(input: FailWebhookInput): Promise<void>;

  get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined>;
  listRetryable(input: ListRetryableInput): Promise<WebhookInboxRecord[]>;
  deleteExpired(input: CleanupInput): Promise<CleanupResult>;
}
