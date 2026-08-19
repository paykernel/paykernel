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
 * True when `error` is a store lease/fencing rejection.
 *
 * **Adapters MUST throw `name === "StoreLeaseLostError"`** (this class or a
 * dual-package / testkit copy). Source of truth for the contract type lives in
 * `@paykernel/store-contracts`.
 *
 * Matches:
 * - {@link StoreLeaseLostError} instances (including cross-realm subclasses)
 * - Errors with `name === "StoreLeaseLostError"` (portable dual copies / testkit)
 *
 * Does **not** match bare `{ code: "lease_lost" }` domain throws — handlers
 * reusing that code for business errors must not skip `store.fail` or look like
 * fencing losses (WEBHOOKS-6). The engine uses this helper, not a code-only
 * check.
 */
export function isStoreLeaseLostError(error: unknown): boolean {
  if (error instanceof StoreLeaseLostError) return true;
  if (error instanceof Error && error.name === "StoreLeaseLostError") return true;
  return false;
}

// ─── Webhook inbox ───────────────────────────────────────────────────────────

/**
 * Inbox row lifecycle status.
 *
 * **Engine + official stores only write:** `pending` | `claimed` | `completed` |
 * `dead_letter`. On fail the engine always targets `pending` (retryable) or
 * `dead_letter` (terminal) — never `failed`.
 *
 * **`failed` is retained on the public union for 0.x schema / claim-surface
 * compatibility** (custom stores may still surface it as terminal via
 * `duplicate_failed`). It is not produced by `createWebhookInboxEngine` or
 * package memory/SQL/Redis adapters.
 */
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
   * Handler attempt budget counter. Each successful `claim` acquire increments by 1
   * unless restored:
   * - `fail({ restoreAttempt: true })` undoes parking claims (`ackAfterClaim`)
   * - soft-release of an **expired** `claimed` lease (via get/listRetryable only)
   *   restores the unfinished claim so pure crash/deploy reclaim does not burn
   *   engine `maxAttempts`
   *
   * Engine `maxAttempts` is max **handler** attempts (outcomes via fail/complete).
   * **WEBHOOKS-2:** `fail` with a matching token succeeds even after lease expiry
   * so hang/timeout handlers still record an attempt (do not soft-restore first).
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
  /**
   * Compare-and-claim fence (S19-WH-HASH-TOCTOU). When set, acquire only if
   * the current row's `payloadHash` equals this value. Mismatch returns
   * `payload_hash_conflict` **without** rewriting hash/body — idle WEBHOOKS-3
   * supersede must not run backwards.
   *
   * `processRetryable` passes the listed hash so a get→claim race cannot roll
   * a newer idle payload back to the list snapshot. Omit on first-delivery
   * `processVerified` so idle hash mismatch still supersedes (WEBHOOKS-3).
   */
  ifMatchPayloadHash?: string;
};

/**
 * Result of an atomic claim attempt.
 *
 * Precedence for an existing row (WEBHOOKS-4 / WEBHOOKS-3):
 * 1. `completed` → `already_completed` (even if `payloadHash` differs)
 * 2. `dead_letter` / `failed` → `duplicate_failed` (even if hash differs)
 * 3. active lease + same hash → `in_progress`
 * 4. active lease + **different** hash → `payload_hash_conflict` (cannot
 *    supersede while another worker holds the row)
 * 5. `ifMatchPayloadHash` set and current hash differs → `payload_hash_conflict`
 *    (no write; S19 — retry workers must not supersede backwards)
 * 6. non-terminal, **no** active lease, different hash → **supersede**: acquire
 *    with the new hash (WEBHOOKS-3 recovery for hash-source mistakes so paid
 *    redrive is not permanently stuck). Updates `payloadHash` / optional
 *    `payloadRef` on acquire. Skipped when `ifMatchPayloadHash` was set (step 5).
 * 7. pending with future `availableAt` + **same** hash → `not_available`
 * 8. else acquire
 *
 * Kinds:
 * - `acquired` — caller holds the lease; run handler or park
 * - `already_completed` / `duplicate_failed` — terminal; do not re-run
 * - `in_progress` — active lease held by another worker
 * - `payload_hash_conflict` — same key, different body hash **while a lease is
 *   still active** (non-terminal), **or** `ifMatchPayloadHash` missed (S19).
 *   Idle pending/expired-claimed rows supersede only when `ifMatchPayloadHash`
 *   is omitted (WEBHOOKS-3).
 * - `not_available` — pending but `availableAt` is still in the future (backoff);
 *   must **not** increment attempts; engine maps to
 *   `scheduled_for_retry { reason: "not_available" }`
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
  /**
   * Matching lease token on a `claimed` row. Wrong/stale (or after reclaim)
   * → {@link StoreLeaseLostError}.
   *
   * **WEBHOOKS-2:** matching token + `status === "claimed"` succeeds even after
   * lease expiry so hang/timeout handlers still record pending/dead_letter.
   * `complete` / `renew` still require an **unexpired** lease.
   */
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
 * After acquire, `renew` / `complete` **require the active `leaseToken`**
 * (unexpired). `fail` requires a matching token on `claimed` and **succeeds
 * after expiry** (WEBHOOKS-2). After lease reclaim, the old token MUST fail.
 *
 * Same event key: second claim with same payload hash while in-progress → in_progress;
 * completed → already_completed (before hash check); dead_letter/failed → duplicate_failed
 * (before hash check); active lease + different hash → payload_hash_conflict;
 * `ifMatchPayloadHash` miss → payload_hash_conflict (no write, S19);
 * non-terminal **idle** different hash → **supersede** acquire (WEBHOOKS-3)
 * unless `ifMatchPayloadHash` was set;
 * pending with `availableAt` in the future and same hash → `not_available`
 * (no acquire, no attempt++); expired lease may be re-acquired with a new
 * fencing token (generation++).
 * Soft-release of expired claimed rows MUST restore one attempt (floor 0) so
 * crash reclaim does not consume the handler `maxAttempts` budget.
 * Direct reclaim of expired `claimed` (without prior soft-release) MUST NOT
 * increment `attempts` either — only pending (handler retry) reclaims burn budget.
 */
export interface WebhookInboxStore extends WithTransaction {
  /**
   * Atomic claim (or re-claim after lease expiry / due availableAt).
   * Increments `generation` and issues a new unguessable `leaseToken` on acquire.
   * Pending reclaim increments `attempts` (handler budget); expired-`claimed`
   * reclaim keeps `attempts` unchanged (crash recovery, WEBHOOKS-1).
   * MUST NOT acquire a pending row whose `availableAt` is still in the future —
   * return `{ kind: "not_available", ... }` instead (no attempt increment).
   * Terminal statuses are classified before hash / lease checks.
   * Non-terminal idle hash mismatch supersedes (WEBHOOKS-3) unless
   * `ifMatchPayloadHash` is set and differs (S19 — no backwards supersede).
   * Active-lease hash mismatch returns `payload_hash_conflict`.
   */
  claim(input: ClaimWebhookInput): Promise<ClaimWebhookResult>;

  /**
   * Extend an active lease. **Requires active `leaseToken`.**
   * On success: rotates token, increments generation; pre-renew token is invalid.
   *
   * **NEW-STORE-3:** must not soft-release an expired lease before the token
   * fence. Expired / mismatched renew fails closed without wiping the row.
   */
  renew(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult>;

  /**
   * Mark event processing complete (terminal).
   * **Requires active `leaseToken`.** Stale/wrong/expired → {@link StoreLeaseLostError}.
   *
   * **NEW-STORE-3:** must not wipe an expired lease before the token check.
   * Token match + unexpired lease records complete; otherwise fail closed
   * without restore-then-lose (`fail` may still record after expiry).
   */
  complete(input: CompleteWebhookInput): Promise<void>;

  /**
   * Record sanitized failure; optionally dead-letter or schedule retry.
   * **Requires matching `leaseToken`** on a claimed row. Stale/wrong →
   * {@link StoreLeaseLostError}.
   *
   * **WEBHOOKS-2:** implementations SHOULD accept a matching token even when
   * the lease has expired (do not soft-release-then-reject). That lets hang/
   * timeout handlers record an attempt so engine `maxAttempts` is effective.
   * Soft-restore of unfinished attempts remains on get/listRetryable only.
   *
   * Sets `availableAt` from `retryAfterMs` (claim gate + list filter).
   * When `restoreAttempt: true`, decrements `attempts` by 1 (floor 0).
   */
  fail(input: FailWebhookInput): Promise<void>;

  get(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined>;

  /**
   * Rows due for worker redrive (`status === "pending"` and `availableAt <= now`).
   *
   * **Soft-release (required):** expired `claimed` rows (lease expired) MUST be
   * treated as reclaimable for poll-only recovery — either soft-release to
   * `pending` (clear lease fields, set `availableAt` <= now, **restore one attempt**
   * so unfinished claims do not burn handler budget) before filtering, or include
   * them as due with equivalent semantics. Official adapters soft-release on
   * `listRetryable` / `get` / `claim` paths. Without this, crash mid-handler after
   * provider 200 can leave money webhooks stuck until a key-addressed claim path runs.
   */
  listRetryable(input: ListRetryableInput): Promise<WebhookInboxRecord[]>;
  deleteExpired(input: CleanupInput): Promise<CleanupResult>;
}
