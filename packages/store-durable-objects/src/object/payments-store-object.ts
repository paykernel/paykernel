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
import type { ShardOccupancyHint } from "../occupancy";
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
type CachedNamespaceStores = {
  idempotency: ReturnType<typeof createDoIdempotencyStore>;
  webhookInbox: ReturnType<typeof createDoWebhookInboxStore>;
  reconciliation: ReturnType<typeof createDoReconciliationStore>;
  schemaReady: boolean;
  schemaPromise: Promise<void> | undefined;
};

export class PaymentsStoreObject {
  readonly storage: DoStorageLike;
  readonly clock: StoreClock;
  private readonly namespace: SchemaNamespaceConfig | undefined;
  private readonly executor: ReturnType<typeof createDoExecutor>;
  private readonly alarmsEnabled: boolean;
  private alarmScheduler: AlarmScheduler | undefined;
  private readonly storeCache = new Map<string, CachedNamespaceStores>();

  constructor(options: PaymentsStoreObjectOptions) {
    this.storage = options.storage;
    this.clock = options.clock ?? createSystemClock();
    this.namespace = options.namespace;
    this.alarmsEnabled = options.alarms?.enabled === true;
    this.executor = createDoExecutor(options.storage);
    this.getOrCreateStores(options.namespace);

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

  private nsCacheKey(ns?: SchemaNamespaceConfig): string {
    if (ns === undefined) return "";
    return JSON.stringify({
      p: ns.tablePrefix ?? "",
      s: ns.sqlSchema ?? "",
      t: ns.tenantColumn ?? false,
    });
  }

  private getOrCreateStores(ns?: SchemaNamespaceConfig): CachedNamespaceStores {
    const key = this.nsCacheKey(ns);
    let cached = this.storeCache.get(key);
    if (cached) return cached;
    const storeOpts = {
      executor: this.executor,
      clock: this.clock,
      ...(ns !== undefined ? { namespace: ns } : {}),
    };
    cached = {
      idempotency: createDoIdempotencyStore(storeOpts),
      webhookInbox: createDoWebhookInboxStore(storeOpts),
      reconciliation: createDoReconciliationStore(storeOpts),
      schemaReady: false,
      schemaPromise: undefined,
    };
    this.storeCache.set(key, cached);
    return cached;
  }

  private ensureCachedSchema(
    cached: CachedNamespaceStores,
    ns?: SchemaNamespaceConfig,
  ): Promise<void> {
    if (cached.schemaReady) return Promise.resolve();
    if (cached.schemaPromise) return cached.schemaPromise;
    const opts = ns !== undefined ? { namespace: ns } : {};
    cached.schemaPromise = ensureDoSchema(this.storage, opts)
      .then(() => {
        cached.schemaReady = true;
      })
      .catch((err) => {
        cached.schemaPromise = undefined;
        throw err;
      });
    return cached.schemaPromise;
  }

  /**
   * Explicit schema ensure (sql-store sqlite foundation).
   * Call from DO constructor (e.g. blockConcurrencyWhile) or ops — never on package import.
   */
  async ensureSchema(namespace?: SchemaNamespaceConfig): Promise<void> {
    const ns = namespace ?? this.namespace;
    const cached = this.getOrCreateStores(ns);
    return this.ensureCachedSchema(cached, ns);
  }

  /**
   * Resolve stores for an RPC. When the Worker sent `tableNamespace`, apply it
   * (constructor default is used when omitted) and ensure that prefix's schema.
   */
  private async readyStores(
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<CachedNamespaceStores> {
    const ns = tableNamespace ?? this.namespace;
    const cached = this.getOrCreateStores(ns);
    if (tableNamespace !== undefined) {
      await this.ensureCachedSchema(cached, ns);
    }
    return cached;
  }

  /**
   * Pin hash `partitions` for this layout meta DO (DO-1).
   *
   * First call stores `partitions`. Later calls with a different count throw —
   * never allow silent re-routing to empty partition objects after N changes.
   * Idempotent when the sealed count matches.
   */
  bindHashPartitionLayout(partitions: number): Promise<void> {
    if (
      typeof partitions !== "number" ||
      !Number.isInteger(partitions) ||
      partitions < 1
    ) {
      return Promise.reject(
        new TypeError(
          "bindHashPartitionLayout: partitions must be an integer >= 1",
        ),
      );
    }
    try {
      this.storage.transactionSync(() => {
        this.storage.sql
          .exec(
            `CREATE TABLE IF NOT EXISTS pk_do_hash_layout (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              partitions INTEGER NOT NULL
            )`,
          )
          .toArray();
        const rows = this.storage.sql
          .exec(
            `SELECT partitions AS partitions FROM pk_do_hash_layout WHERE id = 1`,
          )
          .toArray();
        if (rows.length === 0) {
          this.storage.sql
            .exec(
              `INSERT INTO pk_do_hash_layout (id, partitions) VALUES (1, ?)`,
              partitions,
            )
            .toArray();
          return;
        }
        const sealed = Number(rows[0]!["partitions"]);
        if (sealed !== partitions) {
          throw new TypeError(
            `sharding DO-1: hash partitions sealed as ${sealed} but config is ${partitions}. ` +
              `Changing N re-routes keys and orphans Durable Object state. ` +
              `Keep partitions fixed, or use a new layoutId/objectNamePrefix and migrate — never silently route to empty DOs.`,
          );
        }
      });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // ── Idempotency RPC ──────────────────────────────────────────────────────

  async reserveIdempotency(
    input: ReserveIdempotencyInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<IdempotencyReservation> {
    const s = await this.readyStores(tableNamespace);
    return s.idempotency.reserve(input);
  }

  async renewIdempotency(
    input: RenewIdempotencyReservationInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<RenewReservationResult> {
    const s = await this.readyStores(tableNamespace);
    return s.idempotency.renew(input);
  }

  async completeIdempotency(
    input: CompleteIdempotencyInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<void> {
    const s = await this.readyStores(tableNamespace);
    return s.idempotency.complete(input);
  }

  async markIdempotencyIndeterminate(
    input: MarkIndeterminateInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<void> {
    const s = await this.readyStores(tableNamespace);
    return s.idempotency.markIndeterminate(input);
  }

  async getIdempotency(
    key: IdempotencyKey,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<IdempotencyRecord | undefined> {
    const s = await this.readyStores(tableNamespace);
    return s.idempotency.get(key);
  }

  async deleteExpiredIdempotency(
    input: CleanupInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<CleanupResult> {
    const s = await this.readyStores(tableNamespace);
    return s.idempotency.deleteExpired(input);
  }

  // ── Webhook RPC ──────────────────────────────────────────────────────────

  async claimWebhook(
    input: ClaimWebhookInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<ClaimWebhookResult> {
    const s = await this.readyStores(tableNamespace);
    return s.webhookInbox.claim(input);
  }

  async renewWebhook(
    input: RenewWebhookLeaseInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<RenewWebhookLeaseResult> {
    const s = await this.readyStores(tableNamespace);
    return s.webhookInbox.renew(input);
  }

  async completeWebhook(
    input: CompleteWebhookInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<void> {
    const s = await this.readyStores(tableNamespace);
    return s.webhookInbox.complete(input);
  }

  async failWebhook(
    input: FailWebhookInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<void> {
    const s = await this.readyStores(tableNamespace);
    return s.webhookInbox.fail(input);
  }

  async getWebhook(
    key: WebhookEventKey,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<WebhookInboxRecord | undefined> {
    const s = await this.readyStores(tableNamespace);
    return s.webhookInbox.get(key);
  }

  async peekRetryableWebhooks(
    input: ListRetryableInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<ShardOccupancyHint> {
    const s = await this.readyStores(tableNamespace);
    return s.webhookInbox.peekRetryable(input);
  }

  async listRetryableWebhooks(
    input: ListRetryableInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<WebhookInboxRecord[]> {
    const s = await this.readyStores(tableNamespace);
    return s.webhookInbox.listRetryable(input);
  }

  async deleteExpiredWebhooks(
    input: CleanupInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<CleanupResult> {
    const s = await this.readyStores(tableNamespace);
    return s.webhookInbox.deleteExpired(input);
  }

  // ── Reconciliation RPC ───────────────────────────────────────────────────

  async scheduleReconciliation(
    input: ScheduleReconciliationInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<ScheduleResult> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.schedule(input);
  }

  async claimReconciliation(
    input: ClaimReconciliationInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<ClaimResult> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.claim(input);
  }

  async renewReconciliation(
    input: RenewReconciliationLeaseInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<RenewReconciliationLeaseResult> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.renew(input);
  }

  async completeReconciliation(
    input: CompleteReconciliationInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<void> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.complete(input);
  }

  async failReconciliation(
    input: FailReconciliationInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<void> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.fail(input);
  }

  async markReconciliationManualReview(
    input: MarkManualReviewInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<void> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.markManualReview(input);
  }

  async getReconciliation(
    key: ReconciliationKey,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<ReconciliationRecord | undefined> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.get(key);
  }

  async peekDueReconciliation(
    input: ListDueInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<ShardOccupancyHint> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.peekDue(input);
  }

  async listDueReconciliation(
    input: ListDueInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<ReconciliationRecord[]> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.listDue(input);
  }

  async deleteExpiredReconciliation(
    input: CleanupInput,
    tableNamespace?: SchemaNamespaceConfig,
  ): Promise<CleanupResult> {
    const s = await this.readyStores(tableNamespace);
    return s.reconciliation.deleteExpired(input);
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
