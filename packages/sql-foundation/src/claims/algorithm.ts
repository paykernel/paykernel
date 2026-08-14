/**
 * Pure claim decision rules (generation / attempt / reclaim).
 *
 * These functions encode engine-level intent without performing I/O.
 * SQL adapters map outcomes to single conditional INSERT/UPDATE statements;
 * the memory-relational reference applies them under a mutex.
 *
 * NEVER implement claims as get-then-set across processes — use these
 * decisions only inside an atomic engine write or single-isolate critical section.
 */

import type {
  IdempotencyStatusSql,
  ReconciliationStatusSql,
  WebhookInboxStatusSql,
} from "../schema/tables";

export type ClaimClock = {
  /** Epoch milliseconds. */
  nowMs: number;
};

function isLeaseActive(leaseExpiresAt: string | null | undefined, nowMs: number): boolean {
  if (leaseExpiresAt === null || leaseExpiresAt === undefined || leaseExpiresAt === "") {
    return false;
  }
  const exp = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(exp)) return false;
  return exp > nowMs;
}

function addMsIso(nowMs: number, leaseMs: number): string {
  return new Date(nowMs + leaseMs).toISOString();
}

function nowIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

// ─── Idempotency reserve ─────────────────────────────────────────────────────

export type IdempotencyExistingSnapshot = {
  status: IdempotencyStatusSql;
  fingerprint: string;
  leaseExpiresAt?: string | undefined | null;
  generation: number;
  attempts: number;
  createdAt: string;
  result?: unknown;
};

export type IdempotencyReserveInput = {
  key: string;
  fingerprint: string;
  owner: string;
  leaseMs: number;
  /** Opaque new lease token (caller-generated; unguessable). */
  newLeaseToken: string;
  clock: ClaimClock;
  existing?: IdempotencyExistingSnapshot | undefined;
};

export type IdempotencyReserveDecision =
  | {
      kind: "acquired";
      action: "insert" | "update";
      generation: number;
      attempts: number;
      leaseToken: string;
      leaseOwner: string;
      leaseExpiresAt: string;
      status: "reserved";
      fingerprint: string;
      createdAt: string;
      updatedAt: string;
    }
  | { kind: "already_completed" }
  | { kind: "in_progress" }
  | { kind: "indeterminate" }
  | { kind: "fingerprint_conflict" };

/**
 * Decide reserve outcome for idempotency.
 * On acquire: generation = prior+1 (or 1), attempts = prior+1 (or 1).
 *
 * Classification order: `completed` / `indeterminate` **before**
 * `fingerprint_conflict` so a terminal or A4-parked row re-used with a
 * different digest still blocks replay (does not look like a conflict).
 */
export function decideIdempotencyReserve(
  input: IdempotencyReserveInput,
): IdempotencyReserveDecision {
  const { clock, existing } = input;
  const now = nowIso(clock.nowMs);

  if (!existing) {
    return {
      kind: "acquired",
      action: "insert",
      generation: 1,
      attempts: 1,
      leaseToken: input.newLeaseToken,
      leaseOwner: input.owner,
      leaseExpiresAt: addMsIso(clock.nowMs, input.leaseMs),
      status: "reserved",
      fingerprint: input.fingerprint,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (existing.status === "completed") {
    return { kind: "already_completed" };
  }
  if (existing.status === "indeterminate") {
    return { kind: "indeterminate" };
  }
  if (existing.fingerprint !== input.fingerprint) {
    return { kind: "fingerprint_conflict" };
  }
  if (existing.status === "reserved" && isLeaseActive(existing.leaseExpiresAt, clock.nowMs)) {
    return { kind: "in_progress" };
  }

  // expired or free to re-reserve
  return {
    kind: "acquired",
    action: "update",
    generation: existing.generation + 1,
    attempts: existing.attempts + 1,
    leaseToken: input.newLeaseToken,
    leaseOwner: input.owner,
    leaseExpiresAt: addMsIso(clock.nowMs, input.leaseMs),
    status: "reserved",
    fingerprint: input.fingerprint,
    createdAt: existing.createdAt,
    updatedAt: now,
  };
}

/**
 * Classification of an empty idempotency reserve RETURNING / 0-row UPDATE.
 *
 * Pure rules (same order as {@link decideIdempotencyReserve}): `completed`, then
 * `indeterminate`, then fingerprint mismatch, then reserved + active lease →
 * `in_progress`, else `claimable` (expired/null lease or status expired).
 *
 * When the pure decision would acquire (`claimable`), SQL adapters MUST NOT
 * map the miss to permanent `in_progress`. Prefer canonicalize+retry
 * (`idempotencyTimestampRepairTemplates`) so lexical TEXT lease mismatch
 * cannot freeze reclaim.
 *
 * Repair UPDATE after `claimable` MUST be free-lease fenced
 * (`status = expired` OR lease null/expired OR exact classified snapshot).
 * Never overwrite an active reserved winner's lease from a stale SELECT.
 */
export type IdempotencyReserveMissKind =
  | "already_completed"
  | "indeterminate"
  | "fingerprint_conflict"
  | "in_progress"
  | "claimable";

export type IdempotencyReserveMissSnapshot = {
  status: string;
  fingerprint: string;
  leaseExpiresAt?: string | undefined | null;
};

/**
 * @param existing - Row selected after empty reserve RETURNING (adapters throw when missing).
 * @param inputFingerprint - Caller's request fingerprint.
 * @param nowMs - Claim clock epoch ms.
 */
export function classifyIdempotencyReserveMiss(
  existing: IdempotencyReserveMissSnapshot,
  inputFingerprint: string,
  nowMs: number,
): IdempotencyReserveMissKind {
  if (existing.status === "completed") {
    return "already_completed";
  }
  if (existing.status === "indeterminate") {
    return "indeterminate";
  }
  if (existing.fingerprint !== inputFingerprint) {
    return "fingerprint_conflict";
  }
  if (existing.status === "reserved" && isLeaseActive(existing.leaseExpiresAt, nowMs)) {
    return "in_progress";
  }
  return "claimable";
}

// ─── Webhook claim ───────────────────────────────────────────────────────────

export type WebhookExistingSnapshot = {
  status: WebhookInboxStatusSql;
  payloadHash: string;
  leaseExpiresAt?: string | undefined | null;
  generation: number;
  attempts: number;
  createdAt: string;
  availableAt: string;
  payloadRef?: string | undefined;
};

export type WebhookClaimInput = {
  key: string;
  payloadHash: string;
  owner: string;
  leaseMs: number;
  newLeaseToken: string;
  clock: ClaimClock;
  payloadRef?: string | undefined;
  existing?: WebhookExistingSnapshot | undefined;
};

export type WebhookClaimDecision =
  | {
      kind: "acquired";
      action: "insert" | "update";
      generation: number;
      attempts: number;
      leaseToken: string;
      leaseOwner: string;
      leaseExpiresAt: string;
      status: "claimed";
      payloadHash: string;
      payloadRef?: string | undefined;
      createdAt: string;
      updatedAt: string;
      availableAt: string;
    }
  | { kind: "already_completed" }
  | { kind: "in_progress" }
  /**
   * Pending row is not yet due for claim (`availableAt` in the future).
   * Backoff / retryAfterMs gate — do not increment attempts.
   * Distinct from `in_progress` (active lease held by a worker).
   *
   * Expired-lease reclaim is still allowed even when `availableAt` is in the future
   * (crash recovery path); only `status=pending` is gated by `availableAt`.
   */
  | { kind: "not_available" }
  | { kind: "payload_hash_conflict" }
  | { kind: "duplicate_failed" };

export function decideWebhookClaim(input: WebhookClaimInput): WebhookClaimDecision {
  const { clock, existing } = input;
  const now = nowIso(clock.nowMs);

  if (!existing) {
    const acquired: WebhookClaimDecision = {
      kind: "acquired",
      action: "insert",
      generation: 1,
      attempts: 1,
      leaseToken: input.newLeaseToken,
      leaseOwner: input.owner,
      leaseExpiresAt: addMsIso(clock.nowMs, input.leaseMs),
      status: "claimed",
      payloadHash: input.payloadHash,
      createdAt: now,
      updatedAt: now,
      availableAt: now,
    };
    if (input.payloadRef !== undefined) {
      acquired.payloadRef = input.payloadRef;
    }
    return acquired;
  }

  // Terminal before hash / lease so completed redelivery with mismatched hash
  // still ACKs as already done (not permanent payload_conflict).
  if (existing.status === "completed") {
    return { kind: "already_completed" };
  }
  if (existing.status === "dead_letter" || existing.status === "failed") {
    return { kind: "duplicate_failed" };
  }

  const hashMismatch = existing.payloadHash !== input.payloadHash;
  const leaseActive =
    existing.status === "claimed" &&
    isLeaseActive(existing.leaseExpiresAt, clock.nowMs);

  // Active lease: same hash → in_progress; different hash cannot supersede.
  if (leaseActive) {
    if (hashMismatch) {
      return { kind: "payload_hash_conflict" };
    }
    return { kind: "in_progress" };
  }

  // Idle non-terminal + same hash: honor pending backoff (not_available).
  // Hash mismatch supersedes even during backoff so hash-source mistakes
  // (raw string vs object) do not permanently stick paid redrive.
  if (!hashMismatch && existing.status === "pending") {
    const availableMs = Date.parse(existing.availableAt);
    if (Number.isFinite(availableMs) && availableMs > clock.nowMs) {
      return { kind: "not_available" };
    }
  }

  // pending (due), expired lease, or idle hash supersede → reclaim
  // WEBHOOKS-1: only pending burns an attempt; expired claimed keeps attempts.
  const payloadRef = input.payloadRef ?? existing.payloadRef;
  const nextAttempts =
    existing.status === "claimed" ? existing.attempts : existing.attempts + 1;
  const acquired: WebhookClaimDecision = {
    kind: "acquired",
    action: "update",
    generation: existing.generation + 1,
    attempts: nextAttempts,
    leaseToken: input.newLeaseToken,
    leaseOwner: input.owner,
    leaseExpiresAt: addMsIso(clock.nowMs, input.leaseMs),
    status: "claimed",
    // Supersede stores the caller's hash when it differs.
    payloadHash: input.payloadHash,
    createdAt: existing.createdAt,
    updatedAt: now,
    availableAt: now,
  };
  if (payloadRef !== undefined) {
    acquired.payloadRef = payloadRef;
  }
  return acquired;
}

/**
 * Classification of an empty webhook claim RETURNING / 0-row UPDATE.
 *
 * Pure Date.parse temporal rules (same as {@link decideWebhookClaim}).
 * When the pure decision would acquire (`claimable`), SQL adapters MUST NOT
 * map the miss to permanent `not_available` — that freezes paid redrive forever
 * under lexical TEXT `available_at` mismatch (STORES-4). Prefer canonicalize+retry
 * or a retryable error so pollers can reclaim.
 *
 * **STORES-4:** timestamp-repair UPDATE after `claimable` MUST be free-lease fenced
 * (`status = pending` OR `lease_expires_at` null/expired). Never overwrite an
 * active winner's lease from a stale SELECT snapshot. Use
 * `webhookTimestampRepairTemplates` (or equivalent WHERE).
 */
export type WebhookClaimMissKind =
  | "already_completed"
  | "duplicate_failed"
  | "payload_hash_conflict"
  | "in_progress"
  | "not_available"
  | "claimable";

export type WebhookClaimMissSnapshot = {
  status: string;
  payloadHash: string;
  leaseExpiresAt?: string | undefined | null;
  availableAt: string;
};

/**
 * @param existing - Row selected after empty claim RETURNING (adapters throw when missing).
 * @param inputPayloadHash - Caller's payload hash (for supersede vs conflict).
 * @param nowMs - Claim clock epoch ms.
 */
export function classifyWebhookClaimMiss(
  existing: WebhookClaimMissSnapshot,
  inputPayloadHash: string,
  nowMs: number,
): WebhookClaimMissKind {
  if (existing.status === "completed") {
    return "already_completed";
  }
  if (existing.status === "failed" || existing.status === "dead_letter") {
    return "duplicate_failed";
  }

  const hashMismatch = existing.payloadHash !== inputPayloadHash;
  // Mirror decideWebhookClaim: conflict only under an *active* lease.
  // Idle/expired claimed + different hash is supersede (claimable) — WEBHOOKS-3/4.
  const leaseActive =
    existing.status === "claimed" &&
    isLeaseActive(existing.leaseExpiresAt, nowMs);

  if (leaseActive) {
    if (hashMismatch) {
      return "payload_hash_conflict";
    }
    return "in_progress";
  }

  if (existing.status === "claimed") {
    // Free/expired lease — pure rules reclaim (any hash; supersede on mismatch).
    return "claimable";
  }

  if (existing.status === "pending") {
    // Hash supersede is always claimable even during backoff.
    if (hashMismatch) {
      return "claimable";
    }
    const availableMs = Date.parse(existing.availableAt);
    if (Number.isFinite(availableMs) && availableMs > nowMs) {
      return "not_available";
    }
    // Due, unparseable, or non-canonical form that Date.parse still treats as due.
    return "claimable";
  }

  // Unknown status — do not freeze as not_available; treat as claimable so
  // adapters retry rather than strand paid events.
  return "claimable";
}

// ─── Reconciliation claim ────────────────────────────────────────────────────

export type ReconciliationExistingSnapshot = {
  status: ReconciliationStatusSql;
  leaseExpiresAt?: string | undefined | null;
  generation: number;
  attempts: number;
  dueAt: string;
  createdAt: string;
  subjectId: string;
  reason: string;
};

export type ReconciliationClaimInput = {
  key: string;
  owner: string;
  leaseMs: number;
  newLeaseToken: string;
  clock: ClaimClock;
  existing?: ReconciliationExistingSnapshot | undefined;
};

export type ReconciliationClaimDecision =
  | {
      kind: "acquired";
      action: "update";
      generation: number;
      attempts: number;
      leaseToken: string;
      leaseOwner: string;
      leaseExpiresAt: string;
      status: "claimed";
      updatedAt: string;
    }
  | { kind: "not_found" }
  | { kind: "not_due" }
  | { kind: "in_progress" }
  | { kind: "already_terminal" };

export function decideReconciliationClaim(
  input: ReconciliationClaimInput,
): ReconciliationClaimDecision {
  const { clock, existing } = input;
  if (!existing) {
    return { kind: "not_found" };
  }
  if (
    existing.status === "completed" ||
    existing.status === "failed" ||
    existing.status === "manual_review"
  ) {
    return { kind: "already_terminal" };
  }
  if (existing.status === "claimed" && isLeaseActive(existing.leaseExpiresAt, clock.nowMs)) {
    return { kind: "in_progress" };
  }
  const dueMs = Date.parse(existing.dueAt);
  if (Number.isFinite(dueMs) && dueMs > clock.nowMs) {
    return { kind: "not_due" };
  }

  // STORES-1: scheduled / handler-retry burns an attempt; expired claimed reclaim
  // keeps attempts (crash/deploy thrash must not exhaust maxAttempts without work).
  const nextAttempts =
    existing.status === "claimed" ? existing.attempts : existing.attempts + 1;

  return {
    kind: "acquired",
    action: "update",
    generation: existing.generation + 1,
    attempts: nextAttempts,
    leaseToken: input.newLeaseToken,
    leaseOwner: input.owner,
    leaseExpiresAt: addMsIso(clock.nowMs, input.leaseMs),
    status: "claimed",
    updatedAt: nowIso(clock.nowMs),
  };
}

/**
 * Classification of an empty reconciliation claim RETURNING / 0-row UPDATE.
 *
 * Pure Date.parse temporal rules (same as {@link decideReconciliationClaim}).
 * When the pure decision would acquire (`claimable`), SQL adapters MUST NOT
 * map the miss to `in_progress` — that freezes free due work forever under
 * lexical TEXT timestamp mismatch (SQL-1/SQL-2). Prefer canonicalize+retry
 * or a retryable error so pollers can reclaim.
 *
 * **SQL-1:** timestamp-repair UPDATE after `claimable` MUST be free-lease fenced
 * (`status = scheduled` OR `lease_expires_at` null/expired). Never overwrite an
 * active winner's `lease_expires_at` from a stale SELECT snapshot. Use
 * `reconciliationTimestampRepairTemplates` (or equivalent WHERE).
 */
export type ReconciliationClaimMissKind =
  | "not_found"
  | "already_terminal"
  | "in_progress"
  | "not_due"
  | "claimable";

export type ReconciliationClaimMissSnapshot = {
  status: string;
  leaseExpiresAt?: string | undefined | null;
  dueAt: string;
};

export function classifyReconciliationClaimMiss(
  existing: ReconciliationClaimMissSnapshot | undefined | null,
  nowMs: number,
): ReconciliationClaimMissKind {
  if (!existing) {
    return "not_found";
  }
  if (
    existing.status === "completed" ||
    existing.status === "failed" ||
    existing.status === "manual_review"
  ) {
    return "already_terminal";
  }
  if (existing.status === "claimed" && isLeaseActive(existing.leaseExpiresAt, nowMs)) {
    return "in_progress";
  }
  const dueMs = Date.parse(existing.dueAt);
  if (Number.isFinite(dueMs) && dueMs > nowMs) {
    return "not_due";
  }
  // scheduled|claimed with free/expired lease and due (or unparseable due) → claimable
  return "claimable";
}

/**
 * Whether a mutator lease token is still valid for fencing.
 * Requires matching token + active lease + expected status.
 */
export function isActiveLeaseToken(args: {
  recordToken: string | null | undefined;
  providedToken: string;
  leaseExpiresAt: string | null | undefined;
  nowMs: number;
  status: string;
  expectedStatus: string;
}): boolean {
  if (args.status !== args.expectedStatus) return false;
  if (!args.recordToken || args.recordToken !== args.providedToken) return false;
  return isLeaseActive(args.leaseExpiresAt, args.nowMs);
}

// ─── Unified evaluateClaim (pure, no I/O) ────────────────────────────────────

export type EvaluateClaimRequest =
  | { store: "idempotency"; input: IdempotencyReserveInput }
  | { store: "webhook"; input: WebhookClaimInput }
  | { store: "reconciliation"; input: ReconciliationClaimInput };

export type EvaluateClaimResult =
  | { store: "idempotency"; decision: IdempotencyReserveDecision }
  | { store: "webhook"; decision: WebhookClaimDecision }
  | { store: "reconciliation"; decision: ReconciliationClaimDecision };

/**
 * Pure claim decision dispatcher for unit tests and adapter equivalence proofs.
 * Does not perform SQL or Map I/O — adapters must map `acquired` decisions onto
 * a **single** conditional engine write (or same-isolate critical section).
 *
 * Alias intent of Stream B "evaluateClaim": one entry point covering all stores.
 */
export function evaluateClaim(request: EvaluateClaimRequest): EvaluateClaimResult {
  if (request.store === "idempotency") {
    return {
      store: "idempotency",
      decision: decideIdempotencyReserve(request.input),
    };
  }
  if (request.store === "webhook") {
    return {
      store: "webhook",
      decision: decideWebhookClaim(request.input),
    };
  }
  return {
    store: "reconciliation",
    decision: decideReconciliationClaim(request.input),
  };
}

// ─── Lease-gated mutator decisions (complete / fail / markIndeterminate) ─────

export type LeaseMutationKind =
  "complete" | "fail" | "mark_indeterminate" | "mark_manual_review" | "renew";

export type LeaseMutationInput = {
  /** Record exists? */
  exists: boolean;
  /** Current record status. */
  status: string;
  /** Status required for this mutator (e.g. "reserved" / "claimed"). */
  expectedStatus: string;
  recordToken: string | null | undefined;
  providedToken: string;
  leaseExpiresAt: string | null | undefined;
  nowMs: number;
  /**
   * When false, matching token + expected status is enough even if the lease
   * clock has passed (webhook `fail` WEBHOOKS-2 / `markIndeterminate` A4).
   * Default true: `complete` / `renew` require an unexpired lease.
   */
  requireActiveLease?: boolean;
};

export type LeaseMutationDecision =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "lease_lost" | "wrong_status";
    };

/**
 * Pure fencing decision for lease-gated mutators (complete/fail/renew/…).
 * Stale or wrong tokens → lease_lost; missing row → not_found;
 * unexpected status → wrong_status.
 *
 * `complete` / `renew` pass `requireActiveLease: true` (default).
 * Webhook `fail` and `markIndeterminate` may pass `requireActiveLease: false`
 * so matching token + claimed/reserved succeeds after expiry (WEBHOOKS-2 / A4).
 *
 * Adapters MUST re-check this condition in the same atomic write as the status
 * transition (WHERE lease_token = $tok AND status = …, plus lease_expires_at > $now
 * when an active lease is required).
 */
export function decideLeaseMutation(input: LeaseMutationInput): LeaseMutationDecision {
  if (!input.exists) {
    return { ok: false, reason: "not_found" };
  }
  if (input.status !== input.expectedStatus) {
    return { ok: false, reason: "wrong_status" };
  }
  const requireActive = input.requireActiveLease !== false;
  if (
    !input.recordToken ||
    input.recordToken !== input.providedToken ||
    (requireActive && !isLeaseActive(input.leaseExpiresAt, input.nowMs))
  ) {
    return { ok: false, reason: "lease_lost" };
  }
  return { ok: true };
}

export { isLeaseActive, addMsIso, nowIso };
