/**
 * Engine types: processing modes, outcomes, handler context, options.
 *
 * Modes are fixed at engine construction (never mixed implicitly).
 * Outcomes are framework-agnostic — no Express/Hono HTTP status codes.
 */

import type {
  LeaseToken,
  WebhookEventKey,
  WebhookInboxRecord,
  WebhookInboxStore,
} from "./store";

// ─── Modes (10.3) ────────────────────────────────────────────────────────────

/**
 * Explicit processing mode. Set once on `createWebhookInboxEngine`.
 *
 * - `inline`: await handler; on throw → store.fail (retryable) → `handler_failed`.
 * - `durable_retry`: await handler by default; on retryable throw → store.fail with
 *   delay → `scheduled_for_retry` (`reason: "handler_retry"`). When
 *   `ackAfterClaim: true`, claim persists and returns `scheduled_for_retry`
 *   (`reason: "parked"`) without running the handler (worker via
 *   `processRetryable`). The parking claim does **not** count toward `maxAttempts`
 *   (store `fail({ restoreAttempt: true })`).
 */
export type WebhookProcessingMode = "inline" | "durable_retry";

// ─── Outcomes (10.4) ─────────────────────────────────────────────────────────

/**
 * Why work was deferred under `scheduled_for_retry`.
 *
 * Adapters MUST discriminate these for HTTP policy — a single “retry later”
 * ACK is unsafe when no worker will process the row:
 *
 * - `parked` — durable `ackAfterClaim` released work for `processRetryable`
 *   (safe 200 only when a worker is guaranteed).
 * - `handler_retry` — handler threw retryable; `store.fail` recorded with backoff.
 * - `not_available` — claim backoff (`availableAt` still future); no handler ran.
 *   Prefer 5xx so the provider redelivers unless a durable scheduler owns the row.
 */
export type ScheduledForRetryReason =
  | "parked"
  | "handler_retry"
  | "not_available";

/**
 * Explicit processing outcomes. Framework adapters map these to HTTP/status
 * policy. The engine NEVER hardcodes HTTP response codes.
 *
 * **Silent ACK of failed work is forbidden.** Callers must use the outcome
 * discriminant — never treat claim-without-success as processed.
 */
export type WebhookProcessingOutcome =
  | { outcome: "processed" }
  | { outcome: "duplicate_completed" }
  | { outcome: "already_processing"; retryAfterMs?: number }
  | { outcome: "scheduled_for_retry"; reason: ScheduledForRetryReason }
  | { outcome: "handler_failed"; retryable: boolean }
  | { outcome: "payload_conflict" }
  | { outcome: "invalid_webhook"; reason?: string };

// ─── Clock ───────────────────────────────────────────────────────────────────

/** Injectable clock (structural; tests may pass createFakeClock-like objects). */
export type EngineClock = {
  nowMs(): number;
};

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Application-thrown error that marks non-retryable failure.
 *
 * **Default (`deadLetter` omitted or `true`):** store marks `dead_letter` and
 * outcome is `handler_failed { retryable: false }` — preferred for poison messages.
 *
 * **`{ deadLetter: false }` (opt-in footgun):** engine still returns
 * `handler_failed { retryable: false }` but leaves the row **pending**. Provider
 * redelivery / `processRetryable` can re-run the handler (poison spin risk) until
 * `maxAttempts` is exhausted in `durable_retry` (engine then dead-letters). Prefer
 * the default so poison messages terminal immediately. Use `false` only when you
 * intentionally want a non-retryable signal without terminal storage (rare).
 */
export class NonRetryableHandlerError extends Error {
  readonly deadLetter: boolean;

  constructor(message: string, options?: { deadLetter?: boolean; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "NonRetryableHandlerError";
    this.deadLetter = options?.deadLetter !== false;
  }
}

export type WebhookHandlerContext = {
  key: WebhookEventKey;
  leaseToken: LeaseToken;
  record: WebhookInboxRecord;
  /** Verified+normalized application event (caller-supplied; opaque to engine). */
  event: unknown;
  gateway: string;
  providerEventId: string;
  mode: WebhookProcessingMode;
  /**
   * Renew the active lease. On success, the closed-over lease token is rotated
   * for subsequent complete/fail. On lease_lost, throws {@link import("./store").StoreLeaseLostError}.
   */
  renew: (leaseMs?: number) => Promise<void>;
};

/**
 * Application handler. MUST be idempotent (crash after side effect before
 * complete can re-run the handler after reclaim — see engine crash boundaries).
 */
export type WebhookHandler = (ctx: WebhookHandlerContext) => void | Promise<void>;

// ─── Process inputs ──────────────────────────────────────────────────────────

export type ProcessVerifiedInput = {
  gateway: string;
  providerEventId: string;
  /** Precomputed payload hash (from core `hashWebhookPayload` or equivalent). */
  payloadHash: string;
  /**
   * Verified + normalized event passed to the handler.
   * Engine does not interpret shape.
   */
  event?: unknown;
  /**
   * Optional sanitized envelope snapshot for durable retry (JSON string or
   * serializable object → JSON). NEVER pass raw signatures/secrets.
   * Stored only as `payloadRef` on claim.
   */
  envelope?: unknown;
  /** Override default lease duration for this claim. */
  leaseMs?: number;
  /** Override default owner for this claim. */
  owner?: string;
  /**
   * Handler for this delivery. Required when mode runs the handler inline
   * (inline mode, or durable_retry without ackAfterClaim).
   */
  handler?: WebhookHandler;
  /**
   * Per-call override for durable_retry ack-after-claim (defaults to engine
   * option). When true, returns `scheduled_for_retry` (`reason: "parked"`) after
   * durable claim without running the handler. Parking claim does not consume
   * `maxAttempts`.
   *
   * **Requires `envelope`** (non-empty serializable payload for `payloadRef`).
   * Without a stored payload, workers cannot materialize the event — the engine
   * refuses with `invalid_webhook` rather than parking unfulfillable work.
   */
  ackAfterClaim?: boolean;
};

/**
 * Verify+normalize callback for `processWithVerifier`.
 * Return `{ ok: true, ... }` or `{ ok: false, reason? }` for invalid_webhook.
 */
export type VerifyAndNormalizeResult =
  | {
      ok: true;
      gateway: string;
      providerEventId: string;
      payloadHash: string;
      event?: unknown;
      envelope?: unknown;
    }
  | { ok: false; reason?: string };

export type VerifyAndNormalize = (
  raw: unknown,
) => VerifyAndNormalizeResult | Promise<VerifyAndNormalizeResult>;

export type ProcessWithVerifierInput = {
  raw: unknown;
  verifyAndNormalize: VerifyAndNormalize;
  handler?: WebhookHandler;
  leaseMs?: number;
  owner?: string;
  ackAfterClaim?: boolean;
};

export type ProcessRetryableInput = {
  handler: WebhookHandler;
  /** Max rows to claim+process in this poll. Default 10. */
  limit?: number;
  leaseMs?: number;
  owner?: string;
  /**
   * Resolve handler event/envelope from a pending record.
   *
   * **Default** (when omitted): parse `payloadRef` JSON if present, else
   * `{ key, payloadHash }`. When the parse matches a
   * `PersistedPaymentEventEnvelope` shape (`schemaVersion` + `event` +
   * `payloadHash`), the nested `.event` is passed to the handler so dual-write
   * workers can `fulfill(ctx.event)` without a custom resolver. Plain
   * PaymentEvent / custom shapes are used as-is.
   *
   * Override for custom stores or non-envelope `payloadRef` layouts.
   */
  resolveEvent?: (record: WebhookInboxRecord) => {
    gateway: string;
    providerEventId: string;
    event?: unknown;
    payloadHash: string;
    envelope?: unknown;
  };
};

export type ProcessRetryableItemResult = {
  key: WebhookEventKey;
  outcome: WebhookProcessingOutcome;
};

export type ProcessRetryableResult = {
  items: ProcessRetryableItemResult[];
};

// ─── Engine options ──────────────────────────────────────────────────────────

export type SanitizeErrorFn = (error: unknown) => string;

export type CreateWebhookInboxEngineOptions = {
  store: WebhookInboxStore;
  /**
   * Fixed processing mode. INVARIANT: never changes after construction;
   * `process*` methods do not switch modes.
   */
  mode: WebhookProcessingMode;
  /** Default lease owner string. Default: `"webhook-worker"`. */
  owner?: string;
  /**
   * Default lease duration in ms. Default: 30_000.
   * Must be a finite number `> 0` (constructor throws otherwise).
   */
  defaultLeaseMs?: number;
  /**
   * Max **handler** attempts before dead-letter on durable_retry. Default: 5.
   * Must be a finite integer `>= 1` (constructor throws otherwise).
   * Each claim that runs (or would run) the handler increments store `attempts`.
   * The `ackAfterClaim` parking claim is free (`fail({ restoreAttempt: true })`).
   * Provider redelivery while `availableAt` is in the future returns
   * `not_available` / `scheduled_for_retry` (`reason: "not_available"`) and does
   * not increment attempts.
   */
  maxAttempts?: number;
  /**
   * Default retry delay after handler failure (ms). Default: 5_000.
   * Must be a finite number `>= 0` (constructor throws otherwise).
   * Sets store `availableAt`; both key-addressed claim and listRetryable respect it.
   */
  defaultRetryAfterMs?: number;
  /**
   * durable_retry only: when true, `processVerified` returns
   * `scheduled_for_retry` (`reason: "parked"`) after successful claim without
   * running the handler. Workers must call `processRetryable`.
   * Default: false (run handler in-process).
   * Parking does not consume handler attempt budget.
   * Requires a non-empty `envelope` on each parking `processVerified` call.
   */
  ackAfterClaim?: boolean;
  /** Injectable clock for lease expiry deltas / tests. Default: Date.now. */
  clock?: EngineClock;
  /** Override error sanitizer. Default: {@link import("./sanitize").sanitizeWebhookError}. */
  sanitizeError?: SanitizeErrorFn;
};

export type WebhookInboxEngine = {
  readonly mode: WebhookProcessingMode;
  /**
   * Primary path: verified + normalized input → claim → handler (per mode) → outcome.
   */
  processVerified(input: ProcessVerifiedInput): Promise<WebhookProcessingOutcome>;
  /**
   * Optional wrapper: run injected verifyAndNormalize, then processVerified.
   * On verify failure → `invalid_webhook` (never claims).
   */
  processWithVerifier(input: ProcessWithVerifierInput): Promise<WebhookProcessingOutcome>;
  /**
   * Worker path for **durable_retry** pending rows (`listRetryable` → claim → handler).
   * Throws if engine mode is `inline` (modes are fixed at construction; no silent mix).
   */
  processRetryable(input: ProcessRetryableInput): Promise<ProcessRetryableResult>;
  /**
   * Extend lease for a key. Rotates token on success; returns new token.
   * Stale token → `{ ok: false, reason: "lease_lost" }` (same as store.renew).
   */
  renewLease(
    key: WebhookEventKey,
    leaseToken: LeaseToken,
    leaseMs?: number,
  ): Promise<import("./store").RenewWebhookLeaseResult>;
};
