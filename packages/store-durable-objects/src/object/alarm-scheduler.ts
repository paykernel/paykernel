/**
 * Optional partitioned alarm queue (Phase 17.4).
 *
 * Default-off. Design rules:
 * - One alarm per Durable Object (not one setAlarm per record).
 * - Due work lives in a queue table; alarm handler drains + re-schedules.
 * - Alarms are **at-least-once** — handlers must re-check lease/claim state.
 * - Bounded retries + exponential backoff with jitter.
 *
 * Never hold transactionSync open across external provider I/O.
 */

import type { DoStorageLike } from "../types";
import type { StoreClock } from "../clock";
import { clockNowIso, createSystemClock } from "../clock";

export type DoAlarmSchedulerOptions = {
  storage: DoStorageLike;
  clock?: StoreClock;
  /** Max attempts before dead-lettering a queue item. Default 8. */
  maxRetries?: number;
  /** Base backoff ms. Default 1000. */
  baseBackoffMs?: number;
  /** Max backoff ms. Default 300_000. */
  maxBackoffMs?: number;
  /** Table name for the due queue (validated simple identifier). Default payments_do_alarm_queue */
  queueTable?: string;
};

export type AlarmQueueItem = {
  id: string;
  kind: string;
  payloadJson: string;
  dueAt: string;
  attempts: number;
  lastError?: string;
};

const DEFAULT_QUEUE_TABLE = "payments_do_alarm_queue";

function assertTableName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new TypeError(`alarm queue table name invalid: ${name}`);
  }
  return name;
}

function jitter(ms: number): number {
  const spread = Math.floor(ms * 0.2);
  return ms + Math.floor(Math.random() * (spread + 1)) - Math.floor(spread / 2);
}

function computeBackoff(
  attempts: number,
  baseMs: number,
  maxMs: number,
): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
  return Math.min(maxMs, Math.max(baseMs, jitter(exp)));
}

/**
 * Ensure the alarm queue table exists (explicit; not import-time).
 */
export function ensureAlarmQueueSchema(
  storage: DoStorageLike,
  queueTable: string = DEFAULT_QUEUE_TABLE,
): void {
  const table = assertTableName(queueTable);
  storage.sql
    .exec(
      `
CREATE TABLE IF NOT EXISTS ${table} (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  due_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
`.trim(),
    )
    .toArray();
  storage.sql
    .exec(`CREATE INDEX IF NOT EXISTS idx_${table}_due ON ${table} (due_at)`)
    .toArray();
}

export type AlarmScheduler = {
  /** Enqueue work and ensure one alarm is set for the earliest due time. */
  enqueue(input: {
    id: string;
    kind: string;
    payload: unknown;
    dueAtMs: number;
  }): Promise<void>;
  /** Drain due items (at-least-once). Caller supplies idempotent handler. */
  drain(handler: (item: AlarmQueueItem) => Promise<void> | void): Promise<{
    processed: number;
    failed: number;
  }>;
  /** Schedule next alarm from queue head (or clear). */
  reschedule(): Promise<void>;
  /** Test helper: list queue rows. */
  listDue(nowIso?: string): AlarmQueueItem[];
};

/**
 * Create an optional alarm scheduler bound to one DO's storage.
 * Does nothing useful unless storage has setAlarm/getAlarm/deleteAlarm.
 */
export function createAlarmScheduler(
  options: DoAlarmSchedulerOptions,
): AlarmScheduler {
  const clock = options.clock ?? createSystemClock();
  const maxRetries = options.maxRetries ?? 8;
  const baseBackoffMs = options.baseBackoffMs ?? 1000;
  const maxBackoffMs = options.maxBackoffMs ?? 300_000;
  const table = assertTableName(options.queueTable ?? DEFAULT_QUEUE_TABLE);
  const storage = options.storage;

  function listDue(nowIso?: string): AlarmQueueItem[] {
    const now = nowIso ?? clockNowIso(clock);
    const rows = storage.sql
      .exec(
        `SELECT id, kind, payload_json, due_at, attempts, last_error
         FROM ${table}
         WHERE due_at <= ?
         ORDER BY due_at ASC
         LIMIT 100`,
        now,
      )
      .toArray();
    return rows.map((r) => {
      const item: AlarmQueueItem = {
        id: String(r.id),
        kind: String(r.kind),
        payloadJson: String(r.payload_json),
        dueAt: String(r.due_at),
        attempts: Number(r.attempts ?? 0),
      };
      if (r.last_error != null) item.lastError = String(r.last_error);
      return item;
    });
  }

  async function reschedule(): Promise<void> {
    const head = storage.sql
      .exec(
        `SELECT due_at FROM ${table} ORDER BY due_at ASC LIMIT 1`,
      )
      .toArray()[0];
    if (!head) {
      if (typeof storage.deleteAlarm === "function") {
        await storage.deleteAlarm();
      }
      return;
    }
    const dueMs = Date.parse(String(head.due_at));
    if (typeof storage.setAlarm === "function" && Number.isFinite(dueMs)) {
      await storage.setAlarm(dueMs);
    }
  }

  return {
    async enqueue(input) {
      const now = clockNowIso(clock);
      const dueAt = new Date(input.dueAtMs).toISOString();
      const payloadJson = JSON.stringify(input.payload ?? {});
      storage.transactionSync(() => {
        // Fully consume cursor before exit (DO SQLite: no snapshot across await).
        storage.sql
          .exec(
            `INSERT INTO ${table} (id, kind, payload_json, due_at, attempts, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
               kind = excluded.kind,
               payload_json = excluded.payload_json,
               due_at = excluded.due_at,
               updated_at = excluded.updated_at`,
            input.id,
            input.kind,
            payloadJson,
            dueAt,
            now,
            now,
          )
          .toArray();
      });
      await reschedule();
    },

    async drain(handler) {
      const due = listDue();
      let processed = 0;
      let failed = 0;
      for (const item of due) {
        try {
          // At-least-once: handler must re-check lease/claim state.
          await handler(item);
          storage.sql
            .exec(`DELETE FROM ${table} WHERE id = ?`, item.id)
            .toArray();
          processed += 1;
        } catch (err) {
          failed += 1;
          const attempts = item.attempts + 1;
          const msg =
            err instanceof Error ? err.message.slice(0, 200) : "alarm handler failed";
          if (attempts >= maxRetries) {
            // Dead-letter: leave row with far-future due or delete — we mark attempts and push due far.
            const far = new Date(clock.nowMs() + 365 * 24 * 3600_000).toISOString();
            storage.sql
              .exec(
                `UPDATE ${table} SET attempts = ?, last_error = ?, due_at = ?, updated_at = ? WHERE id = ?`,
                attempts,
                msg,
                far,
                clockNowIso(clock),
                item.id,
              )
              .toArray();
          } else {
            const backoff = computeBackoff(attempts, baseBackoffMs, maxBackoffMs);
            const nextDue = new Date(clock.nowMs() + backoff).toISOString();
            storage.sql
              .exec(
                `UPDATE ${table} SET attempts = ?, last_error = ?, due_at = ?, updated_at = ? WHERE id = ?`,
                attempts,
                msg,
                nextDue,
                clockNowIso(clock),
                item.id,
              )
              .toArray();
          }
        }
      }
      await reschedule();
      return { processed, failed };
    },

    reschedule,
    listDue,
  };
}
