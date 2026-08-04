/**
 * Reconciliation job store contract (Phase 19 — domain ownership).
 *
 * Roadmap §3.4 / §9.1: atomic claim, lease-token fencing, generation rotation.
 * **Contract ownership (Phase 19):** this package owns the domain-facing
 * `ReconciliationStore`. Phase 9 testkit keeps a dual structural copy for
 * conformance + `createMemoryReconciliationStore`. Bidirectional assignability
 * is frozen in tests so contract drift fails CI.
 *
 * Durable adapters MUST pass `runReconciliationStoreConformanceSuite` (still in
 * testkit). This package does NOT import testkit.
 *
 * ### Atomicity
 * `claim` MUST be a single atomic engine-level claim (not get-then-set races).
 *
 * ### Secrets
 * Never store raw signatures, authorization headers, secret tokens, or
 * unredacted provider payloads. `lastError` / `note` must be sanitized.
 *
 * ### Scheduling abstraction
 * No mandatory queue product. Adapters (SQL, Redis, DO, memory) implement this
 * interface; applications use {@link createReconciliationScheduler} for
 * target-aware schedule/claim/complete wrappers.
 */

// ─── Shared primitives ───────────────────────────────────────────────────────

/** Opaque reconciliation job key. */
export type ReconciliationKey = string;

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
 * Portable copy owned by reconciliation so domain code never imports testkit.
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

// ─── Reconciliation job ──────────────────────────────────────────────────────

export type ReconciliationStatus =
  | "scheduled"
  | "claimed"
  | "completed"
  | "failed"
  | "manual_review";

/**
 * Reconciliation job row (claimable).
 *
 * Required: key, status, subjectId, reason, dueAt, attempts, createdAt/updatedAt,
 * generation. Optional lease fields when claimed.
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
 * Reconciliation job store with lease-fenced workers (roadmap §9.1 / Phase 19).
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
