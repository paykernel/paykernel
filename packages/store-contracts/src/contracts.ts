/**
 * Lease-aware store contracts (roadmap §9.1–§9.4) for production adapters and conformance.
 *
 * Authoritative home for adapter-facing contracts (`@paykernel/store-contracts`).
 * Conformance suites live in `@paykernel/testkit` (which re-exports these symbols). Phase 10
 * `@paykernel/webhooks` dual-owns a structurally compatible
 * {@link WebhookInboxStore} (engine package must not import testkit).
 * Phase 19 `@paykernel/reconciliation` dual-owns a structurally
 * compatible {@link ReconciliationStore} (domain package must not import testkit).
 * They are intentionally distinct from core 0.x {@link import("@paykernel/core").IdempotencyStore}
 * (get/set/reserve for gateway mutation guards). Do not mix the two APIs.
 *
 * Prefer the alias {@link LeaseAwareIdempotencyStore} when importing both packages
 * in the same module to avoid name collisions with core `IdempotencyStore`.
 *
 * ## Atomicity (authoritative)
 *
 * - `reserve` / `claim` MUST be a **single atomic engine-level claim**
 *   (conditional INSERT/UPDATE, Redis SET NX + token, DO transactional write, etc.).
 * - Implementations MUST NOT claim multi-process correctness via non-atomic
 *   get-then-set races. Concurrent workers must serialize at the storage engine.
 * - Memory adapters: single-isolate critical sections only; declare NON-DISTRIBUTED.
 * - {@link WithTransaction} is an optional helper. SQL adapters must not `await`
 *   external I/O (provider HTTP, etc.) inside a **synchronous** SQLite / DO transaction.
 *
 * ## Fencing / stale workers (authoritative)
 *
 * - `generation` is a monotonic fencing counter: it MUST increment on every successful
 *   `reserve` / `claim` / `renew` that issues a new lease.
 * - `leaseToken` is an unguessable opaque string. After reclaim or renew, the prior
 *   token MUST fail (`StoreLeaseLostError` or renew `{ ok: false, reason: "lease_lost" }`).
 * - Every mutator after `reserve`/`claim` (`complete`, `fail`, `renew`,
 *   `markIndeterminate`, `markManualReview`) **requires the current `leaseToken`**.
 * - Wrong/stale tokens (and tokens after reclaim/renew) → `StoreLeaseLostError`
 *   (or renew `{ ok: false, reason: "lease_lost" }`).
 * - `complete` / `fail` / `renew` typically also require an **unexpired** lease.
 * - `markIndeterminate` is intentionally more permissive for A4 near-expiry parking:
 *   production SQL/Redis accept `status === "reserved"` + matching token even when
 *   the lease clock has passed, as long as the row has not been reclaimed. After
 *   reclaim, the prior token is fenced. Memory testkit may soft-expire on the
 *   read path first, so post-expiry park can fail there while still succeeding
 *   in production if unreclaimed — not a silent race if token fencing holds.
 *
 * ## Indeterminate blocking (A4)
 *
 * When an idempotency row is `indeterminate`, `reserve` MUST return
 * `{ kind: "indeterminate" }` and MUST NOT hand out a new lease for mutation replay.
 * Operator or reconciliation must resolve the row (out-of-band admin path, explicit
 * reconciliation decision, or a future resolve API). Implementations MUST NOT
 * convert indeterminate into failure/completed without an explicit operator decision.
 * `deleteExpired` MUST NOT remove indeterminate rows by default.
 *
 * Portable timestamps: ISO-8601 strings. Opaque string IDs / lease tokens.
 * Never store raw provider payloads or secrets by default.
 */

// ─── Shared primitives ───────────────────────────────────────────────────────

/** Opaque idempotency key (caller-supplied string). */
export type IdempotencyKey = string;

/** Opaque webhook event key (provider event id + optional partition). */
export type WebhookEventKey = string;

/** Opaque reconciliation job key. */
export type ReconciliationKey = string;

/** Unguessable lease / fencing token (opaque string). */
export type LeaseToken = string;

/** ISO-8601 timestamp string (portable; avoid JS number for 64-bit ids). */
export type IsoTimestamp = string;

export type CleanupInput = {
  /** Delete records whose retention/expiry is at or before this instant (ISO). */
  before: IsoTimestamp;
  /** Optional max rows to delete in one call. */
  limit?: number;
};

export type CleanupResult = {
  deleted: number;
};

/**
 * Optional multi-step transaction helper.
 *
 * - Memory adapters: may clone state and restore on throw (async callbacks OK).
 * - SQL / Durable Object adapters: atomicity must come from the engine.
 *   Never `await` external I/O (provider HTTP, etc.) inside a **synchronous**
 *   SQLite / DO transaction callback. Keep claim/complete mutations only.
 *
 * `withTransaction` is **not** a substitute for engine-level atomic `reserve`/`claim`.
 * Cross-process safety requires conditional writes at the storage engine, not
 * application-level get-then-set.
 */
export type WithTransaction = {
  withTransaction?<T>(fn: () => Promise<T> | T): Promise<T>;
};

// ─── Storage error taxonomy (roadmap §9.4) ───────────────────────────────────

/**
 * Normalized store failure codes (roadmap §9.4).
 *
 * Extension: `payload_hash_conflict` for webhook inbox payload mismatch.
 */
export type StoreErrorCode =
  | "unavailable"
  | "conflict"
  | "lease_lost"
  | "timeout"
  | "serialization_failure"
  | "invalid_schema"
  | "unsupported_feature"
  | "corrupted_record"
  | "payload_hash_conflict";

/** All canonical {@link StoreErrorCode} values (for tests and adapters). */
export const STORE_ERROR_CODES: readonly StoreErrorCode[] = [
  "unavailable",
  "conflict",
  "lease_lost",
  "timeout",
  "serialization_failure",
  "invalid_schema",
  "unsupported_feature",
  "corrupted_record",
  "payload_hash_conflict",
] as const;

/**
 * Normalized storage error. Adapters should throw subclasses or set `code`.
 *
 * **Secrets / payloads:** `message` and any serialized form MUST never include
 * secrets, signatures, authorization headers, or raw provider payloads.
 */
export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly retryable: boolean;

  constructor(
    code: StoreErrorCode,
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "StoreError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export class StoreConflictError extends StoreError {
  constructor(message = "Store conflict", cause?: unknown) {
    super("conflict", message, { retryable: false, cause });
    this.name = "StoreConflictError";
  }
}

/**
 * Lease token stale/wrong/expired, or key missing for a fenced mutation.
 * Callers should treat this as "another worker owns the work" — not as a
 * definitive business failure of the payment itself.
 */
export class StoreLeaseLostError extends StoreError {
  constructor(message = "Lease lost or fencing token rejected", cause?: unknown) {
    super("lease_lost", message, { retryable: false, cause });
    this.name = "StoreLeaseLostError";
  }
}

export class StoreUnavailableError extends StoreError {
  constructor(message = "Store unavailable", cause?: unknown) {
    super("unavailable", message, { retryable: true, cause });
    this.name = "StoreUnavailableError";
  }
}

export class StoreTimeoutError extends StoreError {
  constructor(message = "Store operation timed out", cause?: unknown) {
    super("timeout", message, { retryable: true, cause });
    this.name = "StoreTimeoutError";
  }
}

export class StoreSerializationFailureError extends StoreError {
  constructor(message = "Store serialization / transaction conflict", cause?: unknown) {
    super("serialization_failure", message, { retryable: true, cause });
    this.name = "StoreSerializationFailureError";
  }
}

export class StoreInvalidSchemaError extends StoreError {
  constructor(message = "Store schema invalid or incompatible", cause?: unknown) {
    super("invalid_schema", message, { retryable: false, cause });
    this.name = "StoreInvalidSchemaError";
  }
}

export class StoreUnsupportedFeatureError extends StoreError {
  constructor(message = "Store feature not supported by this adapter", cause?: unknown) {
    super("unsupported_feature", message, { retryable: false, cause });
    this.name = "StoreUnsupportedFeatureError";
  }
}

export class StoreCorruptedRecordError extends StoreError {
  constructor(message = "Store record corrupted or unreadable", cause?: unknown) {
    super("corrupted_record", message, { retryable: false, cause });
    this.name = "StoreCorruptedRecordError";
  }
}

export class StorePayloadHashConflictError extends StoreError {
  constructor(message = "Payload hash conflict for existing key", cause?: unknown) {
    super("payload_hash_conflict", message, { retryable: false, cause });
    this.name = "StorePayloadHashConflictError";
  }
}

/**
 * True when `error` is a lease/fencing rejection (subclass or `StoreError` with
 * `code: "lease_lost"`). Used by conformance suites so adapters need not subclass
 * if they throw a plain {@link StoreError}.
 */
export function isStoreLeaseLostError(error: unknown): boolean {
  if (error instanceof StoreLeaseLostError) return true;
  return error instanceof StoreError && error.code === "lease_lost";
}

// ─── Idempotency store (lease-aware, Phase 9) ────────────────────────────────

export type IdempotencyRecordStatus =
  | "reserved"
  | "completed"
  | "indeterminate"
  | "expired";

/**
 * Lease-aware idempotency row.
 *
 * Required claimable fields: key, status, leaseOwner, leaseToken, leaseExpiresAt,
 * attempts, createdAt/updatedAt (IsoTimestamp), generation (monotonic fencing).
 * Plus fingerprint and optional safe cached result (never secrets).
 */
export type IdempotencyRecord = {
  key: IdempotencyKey;
  status: IdempotencyRecordStatus;
  /** Hash of request params; conflicts if key reused with different fingerprint. */
  fingerprint: string;
  leaseOwner?: string | undefined;
  leaseToken?: LeaseToken | undefined;
  leaseExpiresAt?: IsoTimestamp | undefined;
  /** Cached successful result (never store raw secrets by default). */
  result?: unknown;
  attempts: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** Monotonic generation for fencing (incremented on each successful reserve/renew). */
  generation: number;
};

export type ReserveIdempotencyInput = {
  key: IdempotencyKey;
  fingerprint: string;
  owner: string;
  /** Lease duration in milliseconds from store clock. */
  leaseMs: number;
};

export type IdempotencyReservation =
  | {
      kind: "acquired";
      record: IdempotencyRecord;
      leaseToken: LeaseToken;
    }
  | {
      kind: "already_completed";
      record: IdempotencyRecord;
    }
  | {
      kind: "in_progress";
      record: IdempotencyRecord;
    }
  | {
      /** A4: blocks mutation replay; no new lease issued. */
      kind: "indeterminate";
      record: IdempotencyRecord;
    }
  | {
      kind: "fingerprint_conflict";
      record: IdempotencyRecord;
    };

export type RenewIdempotencyReservationInput = {
  key: IdempotencyKey;
  /** Active lease token from acquire/renew. Stale token → `{ ok: false, reason: "lease_lost" }`. */
  leaseToken: LeaseToken;
  leaseMs: number;
};

/**
 * Successful renew MUST rotate to a new `leaseToken` and increment `generation`.
 * The pre-renew token MUST be rejected by subsequent complete/renew/markIndeterminate.
 */
export type RenewReservationResult =
  | { ok: true; record: IdempotencyRecord; leaseToken: LeaseToken }
  | { ok: false; reason: "lease_lost" | "not_found" | "wrong_status" };

export type CompleteIdempotencyInput = {
  key: IdempotencyKey;
  /** Required active lease token. Wrong/stale/expired → {@link StoreLeaseLostError}. */
  leaseToken: LeaseToken;
  /** Safe-to-cache result; do not store raw provider secrets. */
  result: unknown;
};

export type MarkIndeterminateInput = {
  key: IdempotencyKey;
  /**
   * Current reservation lease token.
   * Wrong/stale token (or token after reclaim) → {@link StoreLeaseLostError}.
   * Expired-but-unreclaimed (`status` still `reserved` + token match) may still
   * park indeterminate (intentional A4 near-expiry parking in SQL/Redis).
   */
  leaseToken: LeaseToken;
  /** Optional non-secret diagnostic code (e.g. "network_timeout"); adapters should sanitize/cap. */
  reason?: string;
};

/**
 * Lease-aware payment-mutation idempotency store (roadmap §9.1).
 *
 * Distinct from core 0.x `IdempotencyStore` (get/set/reserve without lease fencing).
 * Use {@link LeaseAwareIdempotencyStore} as an import alias when both are in scope.
 *
 * ### Atomicity
 * `reserve` MUST be a single atomic engine-level claim. Memory: single-isolate
 * critical section only (NON-DISTRIBUTED). Never advertise get-then-set as correct.
 *
 * ### Lease-gated mutators
 * After a successful `reserve`, every of `renew` / `complete` / `markIndeterminate`
 * **requires the current `leaseToken`**. Wrong or stale tokens throw
 * {@link StoreLeaseLostError} (or renew returns `{ ok: false, reason: "lease_lost" }`).
 * `renew` / `complete` also require an unexpired lease. `markIndeterminate` may
 * still succeed for expired-but-unreclaimed `reserved` rows when the token matches
 * (A4 near-expiry parking); post-reclaim the prior token is fenced.
 *
 * ### Indeterminate (A4)
 * `status === "indeterminate"` permanently blocks automatic replay: `reserve` returns
 * `kind: "indeterminate"` and does not issue a lease. Operator/reconciliation must
 * resolve. `deleteExpired` must not delete indeterminate rows by default, and must
 * only remove terminal `completed` / `expired` rows (not reclaimable `reserved`).
 */
export interface IdempotencyStore extends WithTransaction {
  /**
   * Atomic acquire (or re-acquire after lease expiry).
   * Increments `generation` and issues a new unguessable `leaseToken` on acquire.
   * Must NOT use non-atomic get-then-set across processes.
   */
  reserve(input: ReserveIdempotencyInput): Promise<IdempotencyReservation>;

  /**
   * Extend an active lease. **Requires active `leaseToken`.**
   * On success: rotates token, increments generation; pre-renew token is invalid.
   * Stale/wrong token → `{ ok: false, reason: "lease_lost" }`.
   */
  renew(input: RenewIdempotencyReservationInput): Promise<RenewReservationResult>;

  /**
   * Mark mutation completed and cache a safe result.
   * **Requires active `leaseToken`.** Stale/wrong/expired → {@link StoreLeaseLostError}.
   */
  complete(input: CompleteIdempotencyInput): Promise<void>;

  /**
   * Preserve uncertain outcome. **Requires current `leaseToken`** with
   * `status === "reserved"`. Stale/wrong token (or post-reclaim) →
   * {@link StoreLeaseLostError}. Expired-but-unreclaimed may still park
   * (intentional A4 near-expiry parking; SQL/Redis do not require an active
   * lease clock here). After this, further `reserve` returns
   * `kind: "indeterminate"` (A4 block).
   */
  markIndeterminate(input: MarkIndeterminateInput): Promise<void>;

  get(key: IdempotencyKey): Promise<IdempotencyRecord | undefined>;

  /**
   * Retention cleanup for terminal rows (`completed` / `expired` with
   * `updatedAt <= before`). MUST NOT remove `indeterminate` by default (A4).
   * MUST NOT delete reclaimable `reserved` rows solely because the lease
   * clock passed — soft-release / reclaim is a separate path.
   */
  deleteExpired(input: CleanupInput): Promise<CleanupResult>;
}

/**
 * Explicit alias for the lease-aware testkit contract.
 * Prefer this name when core 0.x `IdempotencyStore` is also imported.
 */
export type LeaseAwareIdempotencyStore = IdempotencyStore;

// ─── Webhook inbox ───────────────────────────────────────────────────────────

export type WebhookInboxStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed"
  | "dead_letter";

/**
 * Webhook inbox row (claimable).
 *
 * Required: key, status, leaseOwner, leaseToken, leaseExpiresAt, attempts,
 * createdAt/updatedAt, generation. Webhook-specific: payloadHash, availableAt.
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
   * Claim/handler attempt count. Successful claim acquire increments by 1 unless
   * a subsequent `fail({ restoreAttempt: true })` undoes a parking claim.
   */
  attempts: number;
  lastError?: string | undefined;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /**
   * Earliest time a key-addressed `claim` may reacquire a pending row (true backoff).
   * Also filters `listRetryable`. Set by `fail(retryAfterMs)`.
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
   * Engine uses this for non-handler releases (`ackAfterClaim` parking).
   * Adapters MUST treat `undefined` as false.
   */
  restoreAttempt?: boolean;
};

export type ListRetryableInput = {
  now?: IsoTimestamp;
  limit?: number;
};

/**
 * Atomic webhook inbox claim store (roadmap §9.1).
 *
 * ### Atomicity
 * `claim` MUST be a single atomic engine-level claim. Not get-then-set races.
 * Memory: single-isolate only (NON-DISTRIBUTED).
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

// ─── Reconciliation ──────────────────────────────────────────────────────────

export type ReconciliationStatus =
  | "scheduled"
  | "claimed"
  | "completed"
  | "failed"
  | "manual_review";

/**
 * Reconciliation job row (claimable).
 *
 * Required: key, status, leaseOwner, leaseToken, leaseExpiresAt, attempts,
 * createdAt/updatedAt, generation. Reconciliation-specific: subjectId, reason, dueAt.
 */
export type ReconciliationRecord = {
  key: ReconciliationKey;
  status: ReconciliationStatus;
  /** Gateway / payment opaque id being reconciled. */
  subjectId: string;
  reason: string;
  leaseOwner?: string | undefined;
  leaseToken?: LeaseToken | undefined;
  leaseExpiresAt?: IsoTimestamp | undefined;
  attempts: number;
  dueAt: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  lastError?: string | undefined;
  /** Monotonic generation; increments on successful claim/renew. */
  generation: number;
};

export type ScheduleReconciliationInput = {
  key: ReconciliationKey;
  subjectId: string;
  reason: string;
  dueAt: IsoTimestamp;
};

export type ScheduleResult =
  | { kind: "scheduled"; record: ReconciliationRecord }
  | { kind: "already_exists"; record: ReconciliationRecord };

export type ClaimReconciliationInput = {
  key: ReconciliationKey;
  owner: string;
  leaseMs: number;
};

export type ClaimResult =
  | { kind: "acquired"; record: ReconciliationRecord; leaseToken: LeaseToken }
  | { kind: "not_due"; record: ReconciliationRecord }
  | { kind: "in_progress"; record: ReconciliationRecord }
  | { kind: "already_terminal"; record: ReconciliationRecord }
  | { kind: "not_found" };

export type RenewReconciliationLeaseInput = {
  key: ReconciliationKey;
  /** Active lease token. Stale → `{ ok: false, reason: "lease_lost" }`. */
  leaseToken: LeaseToken;
  leaseMs: number;
};

/**
 * Successful renew MUST rotate `leaseToken` and increment `generation`.
 * Pre-renew token MUST fail subsequent complete/fail/markManualReview/renew.
 */
export type RenewReconciliationLeaseResult =
  | { ok: true; record: ReconciliationRecord; leaseToken: LeaseToken }
  | { ok: false; reason: "lease_lost" | "not_found" | "wrong_status" };

export type CompleteReconciliationInput = {
  key: ReconciliationKey;
  /** Required active lease token. Wrong/stale/expired → {@link StoreLeaseLostError}. */
  leaseToken: LeaseToken;
};

export type FailReconciliationInput = {
  key: ReconciliationKey;
  /** Required active lease token. Wrong/stale/expired → {@link StoreLeaseLostError}. */
  leaseToken: LeaseToken;
  /** Sanitized error only — never secrets or raw payloads. */
  error: string;
  /** Reschedule for later (ISO). If omitted, remains failed terminal. */
  retryAt?: IsoTimestamp;
};

export type MarkManualReviewInput = {
  key: ReconciliationKey;
  /** Required active lease token. Wrong/stale → {@link StoreLeaseLostError}. */
  leaseToken: LeaseToken;
  /** Optional non-secret operator note. */
  note?: string;
};

export type ListDueInput = {
  now?: IsoTimestamp;
  limit?: number;
};

/**
 * Reconciliation job store with lease-fenced workers (roadmap §9.1).
 *
 * ### Atomicity
 * `claim` MUST be a single atomic engine-level claim. Not get-then-set races.
 * Memory: single-isolate only (NON-DISTRIBUTED).
 *
 * ### Lease-gated mutators
 * After acquire, `renew` / `complete` / `fail` / `markManualReview` **require the
 * active `leaseToken`**. Wrong/stale/expired → {@link StoreLeaseLostError} or
 * renew `lease_lost`. Stale workers must not complete after lease reclaim or renew.
 */
export interface ReconciliationStore extends WithTransaction {
  schedule(input: ScheduleReconciliationInput): Promise<ScheduleResult>;

  /**
   * Atomic claim when due (or re-claim after lease expiry).
   * Increments `generation` and issues a new unguessable `leaseToken` on acquire.
   */
  claim(input: ClaimReconciliationInput): Promise<ClaimResult>;

  /**
   * Extend an active lease. **Requires active `leaseToken`.**
   * On success: rotates token, increments generation; pre-renew token is invalid.
   */
  renew(input: RenewReconciliationLeaseInput): Promise<RenewReconciliationLeaseResult>;

  /**
   * Mark job completed (terminal).
   * **Requires active `leaseToken`.** Stale/wrong/expired → {@link StoreLeaseLostError}.
   */
  complete(input: CompleteReconciliationInput): Promise<void>;

  /**
   * Fail terminal or reschedule via `retryAt`.
   * **Requires active `leaseToken`.** Stale/wrong → {@link StoreLeaseLostError}.
   */
  fail(input: FailReconciliationInput): Promise<void>;

  /**
   * Route to human review (terminal).
   * **Requires active `leaseToken`.** Stale/wrong → {@link StoreLeaseLostError}.
   */
  markManualReview(input: MarkManualReviewInput): Promise<void>;

  get(key: ReconciliationKey): Promise<ReconciliationRecord | undefined>;
  listDue(input: ListDueInput): Promise<ReconciliationRecord[]>;
  deleteExpired(input: CleanupInput): Promise<CleanupResult>;
}
