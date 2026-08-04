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

  if (existing.fingerprint !== input.fingerprint) {
    return { kind: "fingerprint_conflict" };
  }
  if (existing.status === "completed") {
    return { kind: "already_completed" };
  }
  if (existing.status === "indeterminate") {
    return { kind: "indeterminate" };
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

  if (existing.payloadHash !== input.payloadHash) {
    return { kind: "payload_hash_conflict" };
  }
  if (existing.status === "completed") {
    return { kind: "already_completed" };
  }
  if (existing.status === "dead_letter" || existing.status === "failed") {
    return { kind: "duplicate_failed" };
  }
  if (existing.status === "claimed" && isLeaseActive(existing.leaseExpiresAt, clock.nowMs)) {
    return { kind: "in_progress" };
  }

  // pending + future availableAt → block claim (backoff). Expired lease reclaim
  // is allowed even if availableAt is still in the future (crash recovery).
  if (existing.status === "pending") {
    const availableMs = Date.parse(existing.availableAt);
    if (Number.isFinite(availableMs) && availableMs > clock.nowMs) {
      return { kind: "not_available" };
    }
  }

  // pending (due) or expired lease → reclaim
  const payloadRef = input.payloadRef ?? existing.payloadRef;
  const acquired: WebhookClaimDecision = {
    kind: "acquired",
    action: "update",
    generation: existing.generation + 1,
    attempts: existing.attempts + 1,
    leaseToken: input.newLeaseToken,
    leaseOwner: input.owner,
    leaseExpiresAt: addMsIso(clock.nowMs, input.leaseMs),
    status: "claimed",
    payloadHash: existing.payloadHash,
    createdAt: existing.createdAt,
    updatedAt: now,
    availableAt: now,
  };
  if (payloadRef !== undefined) {
    acquired.payloadRef = payloadRef;
  }
  return acquired;
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

  return {
    kind: "acquired",
    action: "update",
    generation: existing.generation + 1,
    attempts: existing.attempts + 1,
    leaseToken: input.newLeaseToken,
    leaseOwner: input.owner,
    leaseExpiresAt: addMsIso(clock.nowMs, input.leaseMs),
    status: "claimed",
    updatedAt: nowIso(clock.nowMs),
  };
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
   * For renew: whether to require unexpired lease (default true).
   * Complete/fail always require active lease.
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
 * Stale, wrong, or expired tokens → lease_lost; missing row → not_found;
 * unexpected status → wrong_status.
 *
 * Adapters MUST re-check this condition in the same atomic write as the status
 * transition (WHERE lease_token = $tok AND lease_expires_at > $now AND status = …).
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
