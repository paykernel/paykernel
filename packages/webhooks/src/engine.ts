/**
 * Webhook inbox engine (Phase 10.1–10.6).
 *
 * Ordered pipeline for `processVerified`:
 * 1. validate inputs (gateway, providerEventId, payloadHash)
 * 2. derive key via `deriveWebhookEventKey`
 * 3. atomic `store.claim`
 * 4. map claim kinds → outcomes (no handler on non-acquired)
 * 5. mode branch: ackAfterClaim (durable) or run handler
 * 6. run application handler under lease (with `ctx.renew`)
 * 7. on success → `store.complete` → `processed`
 * 8. on handler throw → sanitize → `store.fail` → mode-specific outcome
 * 9. complete throwing lease_lost after handler success → `handler_failed` retryable
 *    (crash boundary: external side effect may have committed; do NOT report processed)
 *
 * ### Crash boundaries (10.6)
 * | Boundary | Behavior |
 * | -------- | -------- |
 * | Before claim | No store mutation; safe to retry delivery |
 * | After claim, before handler | Lease held; abandon → reclaim after expiry; handler not run |
 * | During handler | Lease held; abandon → reclaim; **handler must be idempotent** |
 * | After side effect, before complete | Reclaim re-runs handler; complete may fail with lease_lost for stale worker |
 * | After complete | Terminal; further process → `duplicate_completed` |
 *
 * **Handler idempotency is mandatory.** The inbox cannot atomically commit an
 * arbitrary external side effect with its completion row unless they share a
 * transaction boundary.
 *
 * **Silent ACK forbidden:** failed/uncertain work returns an explicit
 * {@link WebhookProcessingOutcome} — never imply success without `processed`
 * or intentional `duplicate_completed` / `scheduled_for_retry`.
 *
 * Modes are fixed at construction (`inline` | `durable_retry`).
 */

import { hashWebhookPayload } from "@paykernel/core";
import { deriveWebhookEventKey, parseWebhookEventKey } from "./event-key";
import { sanitizeWebhookError } from "./sanitize";
import {
  isStoreLeaseLostError,
  StoreLeaseLostError,
  type LeaseToken,
  type WebhookEventKey,
  type WebhookInboxRecord,
  type WebhookInboxStore,
  type RenewWebhookLeaseResult,
} from "./store";
import type {
  CreateWebhookInboxEngineOptions,
  EngineClock,
  ProcessRetryableInput,
  ProcessRetryableResult,
  ProcessVerifiedInput,
  ProcessWithVerifierInput,
  SanitizeErrorFn,
  WebhookHandler,
  WebhookHandlerContext,
  WebhookInboxEngine,
  WebhookProcessingMode,
  WebhookProcessingOutcome,
} from "./types";
import { NonRetryableHandlerError } from "./types";

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_OWNER = "webhook-worker";
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_AFTER_MS = 5_000;

/**
 * Lease duration must be a finite number of milliseconds strictly greater than 0.
 * `leaseMs <= 0` would yield an immediately expired lease (complete loses fencing;
 * successful handlers map to retryable handler_failed).
 */
function assertPositiveLeaseMs(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `createWebhookInboxEngine: ${label} must be a finite number > 0 (got ${String(value)})`,
    );
  }
  return value;
}

const systemClock: EngineClock = {
  nowMs: () => Date.now(),
};

// ─── Outcome helpers (exactOptionalPropertyTypes-safe) ───────────────────────

function outcomeProcessed(): WebhookProcessingOutcome {
  return { outcome: "processed" };
}

function outcomeDuplicateCompleted(): WebhookProcessingOutcome {
  return { outcome: "duplicate_completed" };
}

function outcomeAlreadyProcessing(
  retryAfterMs?: number,
): WebhookProcessingOutcome {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return { outcome: "already_processing", retryAfterMs };
  }
  return { outcome: "already_processing" };
}

function outcomeScheduledForRetry(): WebhookProcessingOutcome {
  return { outcome: "scheduled_for_retry" };
}

function outcomeHandlerFailed(retryable: boolean): WebhookProcessingOutcome {
  return { outcome: "handler_failed", retryable };
}

function outcomePayloadConflict(): WebhookProcessingOutcome {
  return { outcome: "payload_conflict" };
}

function outcomeInvalidWebhook(reason?: string): WebhookProcessingOutcome {
  if (reason !== undefined && reason.length > 0) {
    return { outcome: "invalid_webhook", reason };
  }
  return { outcome: "invalid_webhook" };
}

// ─── Payload hash helper ─────────────────────────────────────────────────────

/**
 * Compute a redacted portable SHA-256 payload hash via core `hashWebhookPayload`.
 * Prefer passing a precomputed hash into `processVerified` when available.
 */
export function computePayloadHash(raw: unknown): string {
  return hashWebhookPayload(raw);
}

// ─── Envelope → payloadRef ───────────────────────────────────────────────────

/**
 * Serialize an envelope for `payloadRef` storage.
 *
 * Objects are `JSON.stringify`'d as-is; strings are used as-is; never stores
 * undefined. **No forced redaction** — the engine does not strip secrets from
 * `envelope`. Callers must pass a sanitized snapshot
 * (`toPersistedPaymentEventEnvelope` from `@paykernel/core`) or strip secrets
 * before claim / processVerified.
 */
function envelopeToPayloadRef(envelope: unknown): string | undefined {
  if (envelope === undefined || envelope === null) return undefined;
  if (typeof envelope === "string") {
    return envelope.length > 0 ? envelope : undefined;
  }
  try {
    return JSON.stringify(envelope);
  } catch {
    return undefined;
  }
}

/**
 * Structural check for core `PersistedPaymentEventEnvelope`
 * (`{ schemaVersion, event, payloadHash, storedAt? }`).
 *
 * Used by default `processRetryable` materialization to unwrap `.event` so
 * handlers receive the nested PaymentEvent (or plain object), not the wrapper.
 * Plain PaymentEvent / custom payloadRef shapes lack top-level `event`+`payloadHash`
 * and are left as-is.
 */
function isPersistedPaymentEventEnvelopeShape(
  value: unknown,
): value is {
  schemaVersion: unknown;
  event: unknown;
  payloadHash: unknown;
} {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    "schemaVersion" in v &&
    "event" in v &&
    "payloadHash" in v &&
    typeof v.payloadHash === "string"
  );
}

/**
 * Default payloadRef → handler event for `processRetryable`.
 * Dual-write envelopes auto-unwrap `.event`; plain events stay as-is.
 */
function materializeEventFromPayloadRef(payloadRef: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadRef) as unknown;
  } catch {
    // payloadRef may be opaque non-JSON; pass through as event.
    return payloadRef;
  }
  if (isPersistedPaymentEventEnvelopeShape(parsed)) {
    return parsed.event;
  }
  return parsed;
}

function isNonRetryable(error: unknown): boolean {
  if (error instanceof NonRetryableHandlerError) return true;
  if (
    typeof error === "object" &&
    error !== null &&
    "deadLetter" in error &&
    (error as { deadLetter: unknown }).deadLetter === true
  ) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    (error as { retryable: unknown }).retryable === false
  ) {
    return true;
  }
  return false;
}

/**
 * Whether store.fail should mark dead_letter (terminal) vs pending retry.
 *
 * `maxAttempts` is max **handler** attempts (claim counter after real handler
 * work; parking `ackAfterClaim` restores the parking claim via restoreAttempt).
 */
function shouldDeadLetter(error: unknown, attempts: number, maxAttempts: number, mode: WebhookProcessingMode): boolean {
  if (error instanceof NonRetryableHandlerError) {
    if (error.deadLetter) return true;
    // { deadLetter: false } is an opt-in non-terminal path. Prefer default
    // (deadLetter true). In durable_retry still exhaust maxAttempts so a poison
    // message cannot spin forever via processRetryable / redelivery.
    return mode === "durable_retry" && attempts >= maxAttempts;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "deadLetter" in error &&
    (error as { deadLetter: unknown }).deadLetter === true
  ) {
    return true;
  }
  // Non-retryable without explicit deadLetter=false → terminal.
  if (isNonRetryable(error)) return true;
  // durable_retry: exhaust handler attempts → dead letter.
  if (mode === "durable_retry" && attempts >= maxAttempts) return true;
  return false;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * Create a webhook inbox engine bound to a store and **fixed** processing mode.
 *
 * @example
 * ```ts
 * const engine = createWebhookInboxEngine({
 *   store,
 *   mode: "inline",
 *   clock: { nowMs: () => Date.now() },
 * });
 * const outcome = await engine.processVerified({
 *   gateway: "stripe",
 *   providerEventId: "evt_1",
 *   payloadHash: computePayloadHash(body),
 *   event: normalized,
 *   handler: async (ctx) => { await fulfill(ctx.event); },
 * });
 * ```
 */
export function createWebhookInboxEngine(
  options: CreateWebhookInboxEngineOptions,
): WebhookInboxEngine {
  const store: WebhookInboxStore = options.store;
  const mode: WebhookProcessingMode = options.mode;
  if (mode !== "inline" && mode !== "durable_retry") {
    throw new Error(
      `createWebhookInboxEngine: mode must be "inline" or "durable_retry", got ${String(mode)}`,
    );
  }

  const defaultOwner = options.owner ?? DEFAULT_OWNER;
  const defaultLeaseMs = assertPositiveLeaseMs(
    options.defaultLeaseMs ?? DEFAULT_LEASE_MS,
    "defaultLeaseMs",
  );
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const defaultRetryAfterMs = options.defaultRetryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
  const engineAckAfterClaim = options.ackAfterClaim === true;
  const clock: EngineClock = options.clock ?? systemClock;
  const sanitize: SanitizeErrorFn =
    options.sanitizeError ?? ((err) => sanitizeWebhookError(err));

  if (engineAckAfterClaim && mode !== "durable_retry") {
    throw new Error(
      'createWebhookInboxEngine: ackAfterClaim is only valid with mode "durable_retry"',
    );
  }

  function retryAfterFromRecord(record: WebhookInboxRecord): number | undefined {
    if (!record.leaseExpiresAt) return undefined;
    const exp = Date.parse(record.leaseExpiresAt);
    if (!Number.isFinite(exp)) return undefined;
    const delta = exp - clock.nowMs();
    return delta > 0 ? delta : 0;
  }

  async function runHandlerUnderLease(args: {
    key: WebhookEventKey;
    leaseToken: LeaseToken;
    record: WebhookInboxRecord;
    gateway: string;
    providerEventId: string;
    event: unknown;
    handler: WebhookHandler;
    /** Default lease extension for ctx.renew() when caller omits ms. */
    leaseMs: number;
  }): Promise<WebhookProcessingOutcome> {
    let currentToken = args.leaseToken;
    let currentRecord = args.record;

    const renew = async (leaseMs?: number): Promise<void> => {
      // Prefer caller's ms, else this claim's leaseMs (not only engine default).
      const ms = assertPositiveLeaseMs(
        leaseMs ?? args.leaseMs,
        leaseMs !== undefined ? "leaseMs" : "defaultLeaseMs",
      );
      const result = await store.renew({
        key: args.key,
        leaseToken: currentToken,
        leaseMs: ms,
      });
      if (!result.ok) {
        throw new StoreLeaseLostError(
          `renewLease failed: ${result.reason}`,
        );
      }
      currentToken = result.leaseToken;
      currentRecord = result.record;
    };

    const ctx: WebhookHandlerContext = {
      key: args.key,
      get leaseToken() {
        return currentToken;
      },
      get record() {
        return currentRecord;
      },
      event: args.event,
      gateway: args.gateway,
      providerEventId: args.providerEventId,
      mode,
      renew,
    };

    try {
      await args.handler(ctx);
    } catch (err) {
      // Stale renew / lease lost during handler → retryable; skip fail() with dead token.
      if (isStoreLeaseLostError(err)) {
        return outcomeHandlerFailed(true);
      }

      const nonRetry = isNonRetryable(err);
      const deadLetter = shouldDeadLetter(
        err,
        currentRecord.attempts,
        maxAttempts,
        mode,
      );

      const sanitized = sanitize(err);
      const failInput: {
        key: WebhookEventKey;
        leaseToken: LeaseToken;
        error: string;
        deadLetter?: boolean;
        retryAfterMs?: number;
      } = {
        key: args.key,
        leaseToken: currentToken,
        error: sanitized,
      };
      if (deadLetter) {
        failInput.deadLetter = true;
      } else {
        failInput.retryAfterMs = defaultRetryAfterMs;
      }

      try {
        await store.fail(failInput);
      } catch (failErr) {
        if (isStoreLeaseLostError(failErr)) {
          return outcomeHandlerFailed(true);
        }
        throw failErr;
      }

      if (deadLetter || nonRetry) {
        return outcomeHandlerFailed(false);
      }
      if (mode === "durable_retry") {
        return outcomeScheduledForRetry();
      }
      return outcomeHandlerFailed(true);
    }

    // Handler succeeded — complete with current (possibly rotated) token.
    try {
      await store.complete({
        key: args.key,
        leaseToken: currentToken,
      });
      return outcomeProcessed();
    } catch (completeErr) {
      // Crash boundary: side effect may have committed; never report processed.
      if (isStoreLeaseLostError(completeErr)) {
        return outcomeHandlerFailed(true);
      }
      throw completeErr;
    }
  }

  async function processVerified(
    input: ProcessVerifiedInput,
  ): Promise<WebhookProcessingOutcome> {
    const gateway =
      typeof input.gateway === "string" ? input.gateway.trim() : "";
    const providerEventId =
      typeof input.providerEventId === "string"
        ? input.providerEventId.trim()
        : "";
    const payloadHash =
      typeof input.payloadHash === "string" ? input.payloadHash.trim() : "";

    if (!gateway) {
      return outcomeInvalidWebhook("gateway is required");
    }
    if (!providerEventId) {
      return outcomeInvalidWebhook("providerEventId is required");
    }
    if (!payloadHash) {
      return outcomeInvalidWebhook("payloadHash is required");
    }

    let key: string;
    try {
      key = deriveWebhookEventKey(gateway, providerEventId);
    } catch (e) {
      return outcomeInvalidWebhook(
        e instanceof Error ? e.message : "invalid event key",
      );
    }

    // Mode branch must be known before claim so we never claim without a path
    // to complete/fail (handler required unless durable ack-after-claim).
    const ackAfterClaim =
      mode === "durable_retry" &&
      (input.ackAfterClaim === true ||
        (input.ackAfterClaim === undefined && engineAckAfterClaim));

    if (!ackAfterClaim && !input.handler) {
      return outcomeInvalidWebhook(
        "handler is required when running handler inline",
      );
    }

    const owner = input.owner ?? defaultOwner;
    const leaseMs = assertPositiveLeaseMs(
      input.leaseMs ?? defaultLeaseMs,
      input.leaseMs !== undefined ? "leaseMs" : "defaultLeaseMs",
    );
    const payloadRef = envelopeToPayloadRef(input.envelope);

    const claimInput: {
      key: string;
      payloadHash: string;
      owner: string;
      leaseMs: number;
      payloadRef?: string;
    } = {
      key,
      payloadHash,
      owner,
      leaseMs,
    };
    if (payloadRef !== undefined) {
      claimInput.payloadRef = payloadRef;
    }

    const claim = await store.claim(claimInput);

    switch (claim.kind) {
      case "already_completed":
        return outcomeDuplicateCompleted();
      case "in_progress":
        return outcomeAlreadyProcessing(retryAfterFromRecord(claim.record));
      case "payload_hash_conflict":
        return outcomePayloadConflict();
      case "duplicate_failed":
        // Terminal failed / dead_letter at store level — not retryable via engine.
        return outcomeHandlerFailed(false);
      case "not_available":
        // Backoff: provider redelivery during availableAt window must not burn attempts.
        return outcomeScheduledForRetry();
      case "acquired":
        break;
      default: {
        const _exhaustive: never = claim;
        return outcomeInvalidWebhook(
          `unknown claim kind: ${String((_exhaustive as { kind: string }).kind)}`,
        );
      }
    }

    if (ackAfterClaim) {
      // Store contract has no "release to pending" op: fail with retryAfterMs=0
      // parks the row for processRetryable without treating HTTP as processed.
      // restoreAttempt undoes the parking claim's attempt++ so maxAttempts remains
      // max *handler* attempts (parking claim is free).
      try {
        await store.fail({
          key,
          leaseToken: claim.leaseToken,
          error: "ack_after_claim: scheduled for durable worker",
          retryAfterMs: 0,
          restoreAttempt: true,
        });
      } catch (err) {
        if (isStoreLeaseLostError(err)) {
          // Token dead before restoreAttempt applied (clock/lease skew): claim
          // already persisted; may leave parking attempt burned. No safe
          // tokenless restore — return scheduled_for_retry, not business failure.
          return outcomeScheduledForRetry();
        }
        throw err;
      }
      return outcomeScheduledForRetry();
    }

    // Unreachable under normal control flow: missing handler is rejected before
    // claim when !ackAfterClaim. Kept solely for TypeScript narrowing / defense.
    const handler = input.handler;
    if (!handler) {
      return outcomeInvalidWebhook(
        "handler is required when running handler inline",
      );
    }

    return runHandlerUnderLease({
      key,
      leaseToken: claim.leaseToken,
      record: claim.record,
      gateway,
      providerEventId,
      event: input.event,
      handler,
      leaseMs,
    });
  }

  async function processWithVerifier(
    input: ProcessWithVerifierInput,
  ): Promise<WebhookProcessingOutcome> {
    let verified;
    try {
      verified = await input.verifyAndNormalize(input.raw);
    } catch (err) {
      return outcomeInvalidWebhook(sanitize(err));
    }
    if (!verified.ok) {
      return outcomeInvalidWebhook(verified.reason);
    }

    const next: ProcessVerifiedInput = {
      gateway: verified.gateway,
      providerEventId: verified.providerEventId,
      payloadHash: verified.payloadHash,
    };
    if (verified.event !== undefined) next.event = verified.event;
    if (verified.envelope !== undefined) next.envelope = verified.envelope;
    if (input.handler !== undefined) next.handler = input.handler;
    if (input.leaseMs !== undefined) next.leaseMs = input.leaseMs;
    if (input.owner !== undefined) next.owner = input.owner;
    if (input.ackAfterClaim !== undefined) next.ackAfterClaim = input.ackAfterClaim;

    return processVerified(next);
  }

  async function processRetryable(
    input: ProcessRetryableInput,
  ): Promise<ProcessRetryableResult> {
    // Mode boundary: retry worker path is durable_retry only (never mix with inline).
    if (mode !== "durable_retry") {
      throw new Error(
        'processRetryable is only valid when mode is "durable_retry" (engine mode is fixed at construction)',
      );
    }

    const limit = input.limit ?? 10;
    const owner = input.owner ?? defaultOwner;
    const leaseMs = assertPositiveLeaseMs(
      input.leaseMs ?? defaultLeaseMs,
      input.leaseMs !== undefined ? "leaseMs" : "defaultLeaseMs",
    );
    const pending = await store.listRetryable({ limit });

    const items: ProcessRetryableResult["items"] = [];

    for (const rec of pending) {
      let gateway: string;
      let providerEventId: string;
      let payloadHash: string;
      let event: unknown;

      let payloadRef = rec.payloadRef;
      if (input.resolveEvent) {
        const resolved = input.resolveEvent(rec);
        gateway = resolved.gateway;
        providerEventId = resolved.providerEventId;
        payloadHash = resolved.payloadHash;
        event = resolved.event;
        const fromEnvelope = envelopeToPayloadRef(resolved.envelope);
        if (fromEnvelope !== undefined) payloadRef = fromEnvelope;
      } else {
        const parsed = parseWebhookEventKey(rec.key);
        gateway = parsed?.gateway ?? "unknown";
        providerEventId = parsed?.providerEventId ?? rec.key;
        payloadHash = rec.payloadHash;
        if (rec.payloadRef) {
          event = materializeEventFromPayloadRef(rec.payloadRef);
        } else {
          event = { key: rec.key, payloadHash: rec.payloadHash };
        }
      }

      // Re-claim with same hash (pending after fail/ackAfterClaim).
      const claim = await store.claim({
        key: rec.key,
        payloadHash,
        owner,
        leaseMs,
        ...(payloadRef !== undefined ? { payloadRef } : {}),
      });

      if (claim.kind !== "acquired") {
        const outcome = mapClaimKindToOutcome(claim, retryAfterFromRecord);
        items.push({ key: rec.key, outcome });
        continue;
      }

      const outcome = await runHandlerUnderLease({
        key: rec.key,
        leaseToken: claim.leaseToken,
        record: claim.record,
        gateway,
        providerEventId,
        event,
        handler: input.handler,
        leaseMs,
      });
      items.push({ key: rec.key, outcome });
    }

    return { items };
  }

  async function renewLease(
    key: WebhookEventKey,
    leaseToken: LeaseToken,
    leaseMs?: number,
  ): Promise<RenewWebhookLeaseResult> {
    return store.renew({
      key,
      leaseToken,
      leaseMs: assertPositiveLeaseMs(
        leaseMs ?? defaultLeaseMs,
        leaseMs !== undefined ? "leaseMs" : "defaultLeaseMs",
      ),
    });
  }

  return {
    get mode() {
      return mode;
    },
    processVerified,
    processWithVerifier,
    processRetryable,
    renewLease,
  };
}

function mapClaimKindToOutcome(
  claim: Exclude<
    Awaited<ReturnType<WebhookInboxStore["claim"]>>,
    { kind: "acquired" }
  >,
  retryAfterFromRecord: (r: WebhookInboxRecord) => number | undefined,
): WebhookProcessingOutcome {
  switch (claim.kind) {
    case "already_completed":
      return outcomeDuplicateCompleted();
    case "in_progress":
      return outcomeAlreadyProcessing(retryAfterFromRecord(claim.record));
    case "payload_hash_conflict":
      return outcomePayloadConflict();
    case "duplicate_failed":
      return outcomeHandlerFailed(false);
    case "not_available":
      return outcomeScheduledForRetry();
    default: {
      const _e: never = claim;
      return outcomeInvalidWebhook(String(_e));
    }
  }
}
