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

import {
  hashWebhookPayload,
  redactWebhookPayloadSecrets,
} from "@paykernel/core";
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
  ScheduledForRetryReason,
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

/**
 * maxAttempts: finite integer >= 1 (handler budget; 0 would dead-letter immediately).
 */
function assertMaxAttempts(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `createWebhookInboxEngine: ${label} must be a finite integer >= 1 (got ${String(value)})`,
    );
  }
  return value;
}

/**
 * defaultRetryAfterMs: finite number >= 0 (0 = immediate retry eligibility).
 */
function assertNonNegativeRetryMs(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `createWebhookInboxEngine: ${label} must be a finite number >= 0 (got ${String(value)})`,
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

function outcomeScheduledForRetry(
  reason: ScheduledForRetryReason,
): WebhookProcessingOutcome {
  return { outcome: "scheduled_for_retry", reason };
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

/**
 * WEBHOOKS-2: classify verify/normalize throws that are infrastructure/transport
 * outages (not signature forgery). Callers should map retryable handler_failed
 * to 5xx so providers redeliver (PayPal verify postback outages, network blips).
 */
function isRetryableVerifyInfrastructureError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (typeof err !== "object") return false;
  const e = err as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    statusCode?: unknown;
    retryable?: unknown;
  };
  if (e.retryable === true) return true;
  const name = typeof e.name === "string" ? e.name.toLowerCase() : "";
  const code = typeof e.code === "string" ? e.code.toLowerCase() : "";
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (
    name === "networkerror" ||
    name === "timeouterror" ||
    name === "aborterror" ||
    name === "gatewayapierror" ||
    code === "network_error" ||
    code === "timeout" ||
    code === "etimedout" ||
    code === "econnreset" ||
    code === "econnrefused" ||
    code === "provider_5xx" ||
    code === "gateway_error"
  ) {
    return true;
  }
  if (
    typeof e.statusCode === "number" &&
    e.statusCode >= 500 &&
    e.statusCode < 600
  ) {
    return true;
  }
  if (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("fetch failed") ||
    message.includes("temporarily unavailable")
  ) {
    return true;
  }
  return false;
}

// ─── Payload hash helpers ────────────────────────────────────────────────────

/**
 * Thin wrapper over core `hashWebhookPayload` (redacted portable SHA-256).
 *
 * **Hash-source honesty (WEBHOOKS-2):** this is **not** interchangeable across
 * shapes. `hashWebhookPayload` does **not** JSON-parse non-object strings, so:
 * - `computePayloadHash(parsedObject)` and `computePayloadHash(rawBodyString)`
 *   produce **different** digests even when `rawBodyString` is JSON of the object
 * - Gateways that set `event.payloadHash` (e.g. Stripe with `computePayloadHash`
 *   on the **parsed** event / `rawPayload` object) must be matched on redelivery
 *
 * Prefer {@link resolveInboxPayloadHash} for claim inputs.
 */
export function computePayloadHash(raw: unknown): string {
  return hashWebhookPayload(raw);
}

export type ResolveInboxPayloadHashInput = {
  /**
   * Preferred: gateway/event precomputed hash (trimmed). When non-empty after
   * trim, returned as-is — never re-hashed.
   */
  eventPayloadHash?: string | undefined;
  /**
   * Fallback hash input. Must be the **same object shape** the gateway used for
   * `payloadHash` (typically verified/parsed event or `rawPayload` object).
   * Passing a raw HTTP body **string** is only correct if that string is exactly
   * what was hashed upstream (usually it is not).
   */
  payloadForHash?: unknown;
};

/**
 * Canonical inbox claim hash (WEBHOOKS-2).
 *
 * 1. Prefer `eventPayloadHash` when present (non-empty after trim)
 * 2. Else `hashWebhookPayload(payloadForHash)` on the **gateway-shaped** value
 * 3. Else throw (refuse empty / missing — fail closed)
 *
 * Never treat raw body string hashing as equivalent to object-event hashing
 * without an explicit upstream contract that the gateway hashed that string.
 */
export function resolveInboxPayloadHash(
  input: ResolveInboxPayloadHashInput,
): string {
  const fromEvent =
    typeof input.eventPayloadHash === "string"
      ? input.eventPayloadHash.trim()
      : "";
  if (fromEvent.length > 0) {
    return fromEvent;
  }
  if (input.payloadForHash !== undefined) {
    return hashWebhookPayload(input.payloadForHash);
  }
  throw new Error(
    "resolveInboxPayloadHash: need eventPayloadHash or payloadForHash (refuse empty hash)",
  );
}

// ─── Envelope → payloadRef ───────────────────────────────────────────────────

/**
 * Serialize an envelope/event for `payloadRef` storage.
 *
 * - **Objects / arrays:** deep-redacted via core `redactWebhookPayloadSecrets`
 *   (known secret keys → `"[REDACTED]"`) then `JSON.stringify`. Prefer also
 *   passing `toPersistedPaymentEventEnvelope` so raw signatures never enter.
 * - **JSON strings:** parse → redact object/array values → re-stringify when
 *   parse succeeds as object/array (defense-in-depth for pre-serialized
 *   envelopes). Opaque non-JSON / non-object JSON strings stored as-is.
 * - Never stores undefined / empty string.
 */
function envelopeToPayloadRef(envelope: unknown): string | undefined {
  if (envelope === undefined || envelope === null) return undefined;
  if (typeof envelope === "string") {
    if (envelope.length === 0) return undefined;
    // WEBHOOKS-3/4: try redact when the string is JSON object/array.
    try {
      const parsed = JSON.parse(envelope) as unknown;
      if (parsed !== null && typeof parsed === "object") {
        return JSON.stringify(redactWebhookPayloadSecrets(parsed));
      }
    } catch {
      // opaque non-JSON ref
    }
    return envelope;
  }
  try {
    return JSON.stringify(redactWebhookPayloadSecrets(envelope));
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
 * work; parking `ackAfterClaim` restores via restoreAttempt; crash soft-release
 * restores unfinished claims so deploy reclaim does not burn the budget).
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
 *   // Prefer gateway event.payloadHash; never mix rawBody string vs object hashes
 *   payloadHash: resolveInboxPayloadHash({
 *     eventPayloadHash: webhookEvent.payloadHash,
 *     payloadForHash: webhookEvent.rawPayload ?? webhookEvent,
 *   }),
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
  const maxAttempts = assertMaxAttempts(
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    "maxAttempts",
  );
  const defaultRetryAfterMs = assertNonNegativeRetryMs(
    options.defaultRetryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
    "defaultRetryAfterMs",
  );
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
      // Only real fencing errors (StoreLeaseLostError / name), not bare code:"lease_lost".
      if (isStoreLeaseLostError(err)) {
        return outcomeHandlerFailed(true);
      }

      const nonRetry = isNonRetryable(err);
      const budgetDeadLetter = shouldDeadLetter(
        err,
        currentRecord.attempts,
        maxAttempts,
        mode,
      );

      // WEBHOOKS-1: do NOT permanent-dead-letter solely because payloadRef is
      // missing on a retryable handler failure — that blocks provider redelivery
      // of paid events forever. Claim path requires materializable payload for
      // durable_retry; if a legacy row lacks payloadRef, leave pending/retryable
      // so redelivery or a custom resolveEvent path can recover. processRetryable
      // still refuses stub materialization without payloadRef.
      const deadLetter = budgetDeadLetter;

      const failInput: {
        key: WebhookEventKey;
        leaseToken: LeaseToken;
        error: string;
        deadLetter?: boolean;
        retryAfterMs?: number;
      } = {
        key: args.key,
        leaseToken: currentToken,
        error: sanitize(err),
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
        return outcomeScheduledForRetry("handler_retry");
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
    // Prefer explicit envelope; for durable_retry also snapshot redacted `event`
    // so handler failures can redrive without stub materialization (WEBHOOKS-1).
    const payloadRef =
      envelopeToPayloadRef(input.envelope) ??
      (mode === "durable_retry"
        ? envelopeToPayloadRef(input.event)
        : undefined);

    // Refuse durable_retry claims without a materializable payload — claiming
    // then failing cannot recover paid work, and dead-letter would permanent-block
    // redelivery (WEBHOOKS-1). ackAfterClaim and inline-handler durable paths both
    // need envelope or event before claim.
    if (mode === "durable_retry" && payloadRef === undefined) {
      return outcomeInvalidWebhook(
        "envelope or event is required for durable_retry (workers need a payloadRef to redrive; refusing claim without materializable payload)",
      );
    }

    // Refuse durable park without a materializable payload — otherwise workers
    // cannot redrive and paid fulfillment is lost after ACK.
    if (ackAfterClaim && payloadRef === undefined) {
      return outcomeInvalidWebhook(
        "envelope is required for ackAfterClaim (durable workers need a payloadRef; provide envelope or event)",
      );
    }

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
        // Distinct reason so adapters can 5xx (provider redelivery) instead of silent 200.
        return outcomeScheduledForRetry("not_available");
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
          return outcomeScheduledForRetry("parked");
        }
        throw err;
      }
      return outcomeScheduledForRetry("parked");
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
      // WEBHOOKS-2: infrastructure / transport failures during verify must not
      // look like forgery (invalid_webhook → typically 400). Provider redelivery
      // (esp. PayPal postback outages) needs a retryable signal (5xx class).
      if (isRetryableVerifyInfrastructureError(err)) {
        return outcomeHandlerFailed(true);
      }
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
      let event: unknown | undefined;

      let payloadRef = rec.payloadRef;
      if (input.resolveEvent) {
        const resolved = input.resolveEvent(rec);
        gateway = resolved.gateway;
        providerEventId = resolved.providerEventId;
        payloadHash = resolved.payloadHash;
        event = resolved.event;
        const fromEnvelope = envelopeToPayloadRef(resolved.envelope);
        if (fromEnvelope !== undefined) payloadRef = fromEnvelope;
        // If resolver only provides envelope, materialize event from it.
        if (event === undefined && payloadRef !== undefined) {
          event = materializeEventFromPayloadRef(payloadRef);
        }
      } else {
        const parsed = parseWebhookEventKey(rec.key);
        gateway = parsed?.gateway ?? "unknown";
        providerEventId = parsed?.providerEventId ?? rec.key;
        payloadHash = rec.payloadHash;
        if (rec.payloadRef) {
          event = materializeEventFromPayloadRef(rec.payloadRef);
        }
        // WEBHOOKS-1: never stub `{ key, payloadHash }` — paid data would be lost.
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

      // Fail closed when no materializable handler event (legacy rows / missing ref).
      if (event === undefined) {
        try {
          await store.fail({
            key: rec.key,
            leaseToken: claim.leaseToken,
            error:
              "missing payloadRef: cannot redrive durable webhook without stored envelope/event",
            deadLetter: true,
          });
        } catch (failErr) {
          if (isStoreLeaseLostError(failErr)) {
            items.push({
              key: rec.key,
              outcome: outcomeHandlerFailed(true),
            });
            continue;
          }
          throw failErr;
        }
        items.push({
          key: rec.key,
          outcome: outcomeHandlerFailed(false),
        });
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
      return outcomeScheduledForRetry("not_available");
    default: {
      const _e: never = claim;
      return outcomeInvalidWebhook(String(_e));
    }
  }
}
