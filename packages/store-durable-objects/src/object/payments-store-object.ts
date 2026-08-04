/**
 * In-object Durable Object store logic (plain class; no cloudflare:workers).
 *
 * Production Workers wrap this with `extends DurableObject` and pass
 * `this.ctx.storage` as DoStorageLike. Unit tests pass mock DoStorageLike.
 *
 * Schema ensure is explicit via `ensureSchema()` — typically once in DO
 * constructor inside blockConcurrencyWhile (DO lifecycle, not npm import).
 *
 * RPC methods are async-friendly wrappers over sync SQL claims so Worker
 * stubs can await them. Claims themselves use sync sql.exec / transactionSync.
 *
 * Correct caller pattern:
 *   1) claim (RPC)  2) leave storage txn  3) external provider work  4) complete (RPC)
 */

import type {
  ClaimReconciliationInput,
  ClaimResult,
  ClaimWebhookInput,
  ClaimWebhookResult,
  CleanupInput,
  CleanupResult,
  CompleteIdempotencyInput,
  CompleteReconciliationInput,
  CompleteWebhookInput,
  FailReconciliationInput,
  FailWebhookInput,
  IdempotencyKey,
  IdempotencyRecord,
  IdempotencyReservation,
  ListDueInput,
  ListRetryableInput,
  MarkIndeterminateInput,
  MarkManualReviewInput,
  ReconciliationKey,
  ReconciliationRecord,
  RenewIdempotencyReservationInput,
  RenewReconciliationLeaseInput,
  RenewReconciliationLeaseResult,
  RenewReservationResult,
  RenewWebhookLeaseInput,
  RenewWebhookLeaseResult,
  ReserveIdempotencyInput,
  ScheduleReconciliationInput,
  ScheduleResult,
  WebhookEventKey,
  WebhookInboxRecord,
} from "@paykernel/store-contracts";
import type { SchemaNamespaceConfig } from "@paykernel/sql-foundation";
import type { DoStorageLike } from "../types";
import type { StoreClock } from "../clock";
import { createSystemClock } from "../clock";
import { createDoExecutor } from "../sql-executor";
import { createDoIdempotencyStore } from "../stores/idempotency-store";
import { createDoWebhookInboxStore } from "../stores/webhook-inbox-store";
import { createDoReconciliationStore } from "../stores/reconciliation-store";
import { ensureDoSchema } from "../migrate";
import {
  createAlarmScheduler,
  ensureAlarmQueueSchema,
  type AlarmScheduler,
  type AlarmQueueItem,
} from "./alarm-scheduler";
import type { DoAlarmOptions } from "../types";

export type PaymentsStoreObjectOptions = {
  storage: DoStorageLike;
  clock?: StoreClock;
  namespace?: SchemaNamespaceConfig;
  alarms?: DoAlarmOptions;
};

/**
 * Encapsulates schema ensure + claim RPC methods for one Durable Object partition.
 */
export class PaymentsStoreObject {
  readonly storage: DoStorageLike;
  readonly clock: StoreClock;
  private readonly namespace: SchemaNamespaceConfig | undefined;
  private readonly alarmsEnabled: boolean;
  private alarmScheduler: AlarmScheduler | undefined;
  private schemaReady = false;
  private schemaPromise: Promise<void> | undefined;

  private idempotency: ReturnType<typeof createDoIdempotencyStore>;
  private webhookInbox: ReturnType<typeof createDoWebhookInboxStore>;
  private reconciliation: ReturnType<typeof createDoReconciliationStore>;

  constructor(options: PaymentsStoreObjectOptions) {
    this.storage = options.storage;
    this.clock = options.clock ?? createSystemClock();
    this.namespace = options.namespace;
    this.alarmsEnabled = options.alarms?.enabled === true;

    const executor = createDoExecutor(options.storage);
    const storeOpts = {
      executor,
      clock: this.clock,
      ...(options.namespace !== undefined ? { namespace: options.namespace } : {}),
    };
    this.idempotency = createDoIdempotencyStore(storeOpts);
    this.webhookInbox = createDoWebhookInboxStore(storeOpts);
    this.reconciliation = createDoReconciliationStore(storeOpts);

    if (this.alarmsEnabled) {
      ensureAlarmQueueSchema(options.storage);
      const alarmOpts: {
        storage: DoStorageLike;
        clock: StoreClock;
        maxRetries?: number;
        baseBackoffMs?: number;
        maxBackoffMs?: number;
      } = {
        storage: options.storage,
        clock: this.clock,
      };
      if (options.alarms?.maxRetries !== undefined) {
        alarmOpts.maxRetries = options.alarms.maxRetries;
      }
      if (options.alarms?.baseBackoffMs !== undefined) {
        alarmOpts.baseBackoffMs = options.alarms.baseBackoffMs;
      }
      if (options.alarms?.maxBackoffMs !== undefined) {
        alarmOpts.maxBackoffMs = options.alarms.maxBackoffMs;
      }
      this.alarmScheduler = createAlarmScheduler(alarmOpts);
    }
  }

  /**
   * Explicit schema ensure (sql-store sqlite foundation).
   * Call from DO constructor (e.g. blockConcurrencyWhile) or ops — never on package import.
   */
  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    if (this.schemaPromise) return this.schemaPromise;
    const opts =
      this.namespace !== undefined ? { namespace: this.namespace } : {};
    this.schemaPromise = ensureDoSchema(this.storage, opts)
      .then(() => {
        this.schemaReady = true;
      })
      .catch((err) => {
        // Allow a later retry after a transient ensure failure.
        this.schemaPromise = undefined;
        throw err;
      });
    return this.schemaPromise;
  }

  // ── Idempotency RPC ──────────────────────────────────────────────────────

  reserveIdempotency(
    input: ReserveIdempotencyInput,
  ): Promise<IdempotencyReservation> {
    return this.idempotency.reserve(input);
  }

  renewIdempotency(
    input: RenewIdempotencyReservationInput,
  ): Promise<RenewReservationResult> {
    return this.idempotency.renew(input);
  }

  completeIdempotency(input: CompleteIdempotencyInput): Promise<void> {
    return this.idempotency.complete(input);
  }

  markIdempotencyIndeterminate(input: MarkIndeterminateInput): Promise<void> {
    return this.idempotency.markIndeterminate(input);
  }

  getIdempotency(key: IdempotencyKey): Promise<IdempotencyRecord | undefined> {
    return this.idempotency.get(key);
  }

  deleteExpiredIdempotency(input: CleanupInput): Promise<CleanupResult> {
    return this.idempotency.deleteExpired(input);
  }

  // ── Webhook RPC ──────────────────────────────────────────────────────────

  claimWebhook(input: ClaimWebhookInput): Promise<ClaimWebhookResult> {
    return this.webhookInbox.claim(input);
  }

  renewWebhook(input: RenewWebhookLeaseInput): Promise<RenewWebhookLeaseResult> {
    return this.webhookInbox.renew(input);
  }

  completeWebhook(input: CompleteWebhookInput): Promise<void> {
    return this.webhookInbox.complete(input);
  }

  failWebhook(input: FailWebhookInput): Promise<void> {
    return this.webhookInbox.fail(input);
  }

  getWebhook(key: WebhookEventKey): Promise<WebhookInboxRecord | undefined> {
    return this.webhookInbox.get(key);
  }

  listRetryableWebhooks(input: ListRetryableInput): Promise<WebhookInboxRecord[]> {
    return this.webhookInbox.listRetryable(input);
  }

  deleteExpiredWebhooks(input: CleanupInput): Promise<CleanupResult> {
    return this.webhookInbox.deleteExpired(input);
  }

  // ── Reconciliation RPC ───────────────────────────────────────────────────

  scheduleReconciliation(
    input: ScheduleReconciliationInput,
  ): Promise<ScheduleResult> {
    return this.reconciliation.schedule(input);
  }

  claimReconciliation(input: ClaimReconciliationInput): Promise<ClaimResult> {
    return this.reconciliation.claim(input);
  }

  renewReconciliation(
    input: RenewReconciliationLeaseInput,
  ): Promise<RenewReconciliationLeaseResult> {
    return this.reconciliation.renew(input);
  }

  completeReconciliation(input: CompleteReconciliationInput): Promise<void> {
    return this.reconciliation.complete(input);
  }

  failReconciliation(input: FailReconciliationInput): Promise<void> {
    return this.reconciliation.fail(input);
  }

  markReconciliationManualReview(input: MarkManualReviewInput): Promise<void> {
    return this.reconciliation.markManualReview(input);
  }

  getReconciliation(
    key: ReconciliationKey,
  ): Promise<ReconciliationRecord | undefined> {
    return this.reconciliation.get(key);
  }

  listDueReconciliation(input: ListDueInput): Promise<ReconciliationRecord[]> {
    return this.reconciliation.listDue(input);
  }

  deleteExpiredReconciliation(input: CleanupInput): Promise<CleanupResult> {
    return this.reconciliation.deleteExpired(input);
  }

  // ── Alarms (optional) ────────────────────────────────────────────────────

  /**
   * DO alarm handler entry. At-least-once: handlers must re-check lease/claim state.
   * Default-off unless `alarms.enabled` was set.
   *
   * When `handler` is omitted (e.g. platform `alarm()` with no app wiring yet),
   * only re-schedules the next due time — never drains with a silent success
   * no-op (that would DELETE due queue rows without processing).
   */
  async alarm(
    handler?: (item: AlarmQueueItem) => Promise<void> | void,
  ): Promise<{ processed: number; failed: number }> {
    if (!this.alarmScheduler) {
      return { processed: 0, failed: 0 };
    }
    if (handler === undefined) {
      await this.alarmScheduler.reschedule();
      return { processed: 0, failed: 0 };
    }
    return this.alarmScheduler.drain(handler);
  }

  getAlarmScheduler(): AlarmScheduler | undefined {
    return this.alarmScheduler;
  }
}
