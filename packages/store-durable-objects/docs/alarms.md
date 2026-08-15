# Optional alarms (default-off)

**Package:** `@paykernel/store-durable-objects`  
**API:** `createAlarmScheduler`, `ensureAlarmQueueSchema`, `PaymentsStoreObject` with `alarms: { enabled: true }`

Alarms are **optional** and **default-off**. Enable only when a partition needs deferred drain / retry scheduling.

---

## Rules

1. **One alarm per Durable Object** — not one `setAlarm` per record (avoids alarm storms).
2. Due work lives in a **queue table**; the alarm handler drains due rows and re-schedules the next wake.
3. Alarms are **at-least-once** (Cloudflare may auto-retry). Handlers must **re-check** lease/claim state before side effects (idempotent).
4. **Bounded retries** + exponential **backoff with jitter**.
5. Never hold `transactionSync` open across external provider I/O inside alarm handlers.
6. Do **not** treat alarms as exactly-once delivery.
7. **`failWebhook` is not wired to alarms.** Default recovery is **pull-only**
   (`listRetryable` / `listDue`). Enable the optional alarm queue only when you
   explicitly enqueue work — do not assume `fail` schedules a platform alarm.

## Handler sketch

Wire a real handler on `PaymentsStoreObject.alarm(handler)` (or `createAlarmScheduler().drain`).  
Calling `alarm()` **without** a handler only re-schedules — it does **not** drain (a silent success no-op would DELETE due rows without processing).

```text
alarm(handler) {
  1) load due queue rows for this DO (sync SQL)
  2) for each: re-check claim/lease/state — skip if already terminal or not owned
  3) exit storage txn before any external work
  4) external work → complete/fail with lease token
  5) reschedule one next alarm if queue still has work
}
```

## Docs pin

Cloudflare DO alarms API verified **2026-08-03**:  
https://developers.cloudflare.com/durable-objects/api/alarms/

## Related

- [crash-boundaries.md](./crash-boundaries.md) · [transactions.md](./transactions.md) · [testing.md](./testing.md) · [limits.md](./limits.md)
