# Telemetry redaction (20.4)

Telemetry uses the **same redaction model as logs**: core `redact()` with a shared safe-key allow-list. Observability does **not** reimplement redaction policy.

Core guides:

- [`packages/core/docs/logging.md`](../../core/docs/logging.md) — logger + `redact()`
- [`packages/core/docs/telemetry.md`](../../core/docs/telemetry.md) — `TelemetrySink` + OperationContext

## Why

`TelemetrySink.emit(event, data?)` is an optional raw port on `GatewayContext`. Unredacted `data` can leak secrets the same way unredacted log context can. Phase 20 makes the **default safe path** explicit:

1. Prefer `createRedactingTelemetrySink(appSink)` when attaching application sinks.
2. Prefer `withPaymentOperation` / `recordPaymentOperation`, which always wrap telemetry through the redacting sink before emit.
3. Use `redactTelemetryData(bag)` for one-off bags when you are not wrapping a full sink.

## API

```typescript
import {
  createRedactingTelemetrySink,
  redactTelemetryData,
  type TelemetrySink,
} from "@paykernel/opentelemetry";
// createRedactingTelemetrySink / TelemetrySink also from "@paykernel/core"
// redact() itself is core-only: import { redact } from "@paykernel/core"
```

| Export | Role |
| --- | --- |
| `TelemetrySink` | `{ emit?(event, data?) }` — optional structured sink |
| `createRedactingTelemetrySink(sink)` | **Package-owned** wrap (OBS-1: not a pure core re-export). Uses core `redact()` + defense-in-depth operational restore. Prefer this for observability paths. |
| `redactTelemetryData(data)` | One-shot scrub via core `redact()` + optional operational restore |
| `redactAttributeBag(attrs)` | Span/metric attribute scrubber (package-owned; same model) |

> **OBS-1:** Core also exports a `createRedactingTelemetrySink`. This package’s
> version is **not** a pure re-export — it is implemented here so metrics/spans
> can share package-owned scrubbing. `withPaymentOperation` uses **this**
> package’s wrapper.
>
> **OBS-2:** Core already allow-lists `authorized` in `SAFE_KEY_ALLOWLIST`, so
> substring `auth` does **not** redact that flag today. The operational-key
> restore for `authorized` is **defense-in-depth** only (no-op when core
> preserves the value) and restores **only operational booleans** (`true` /
> `false`). A secret-shaped value such as `{ authorized: "sk_live_…" }` stays
> `[REDACTED]` — restore never unmasks a leaf core redacted because the value
> looked like a credential. Do not document restore as “fixing a core over-match.”

### Redacting sink

```typescript
const raw: TelemetrySink = {
  emit(event, data) {
    // app-owned: ship to logs, metrics bridge, OTEL events, etc.
    console.info(event, data);
  },
};

const safe = createRedactingTelemetrySink(raw);

safe.emit?.("payment.operation", {
  providerRequestId: "req_abc", // visible (allow-listed)
  cardNumber: "4242…",          // → [REDACTED]
  authorization: "Bearer …",    // → [REDACTED]
  clientSecret: "sk_…",         // → [REDACTED]
});
```

When `data` is omitted, the wrapper calls `sink.emit?.(event)` without fabricating an empty object.

### One-shot helper

```typescript
const scrubbed = redactTelemetryData({
  operationId: "op_1",
  token: "secret",
});
// { operationId: "op_1", token: "[REDACTED]" }
```

## Allow-listed diagnostic keys

Keys allow-listed for operational diagnostics (lowercase match; shared with logs via `SAFE_KEY_ALLOWLIST` in core). Phase 20 expansions include keys that would otherwise match broad sensitive substrings (`number`, `name`, `key`):

| Key | Why allow-listed |
| --- | --- |
| `operationId` | Correlation |
| `operationType` | Span/metric naming |
| `providerRequestId` | Provider request debugging (A1) |
| `providerObjectId` | Provider object id |
| `internalReference` | App reference |
| `attemptNumber` | Retry index (`number` substring) |
| `durationMs` / `duration` | Latency |
| `tenant` | Multi-tenant label |
| `namespace` | Env/partition (`name` substring) |
| `inboxEventKey` / `eventKey` | Webhook inbox (`key` substring) |
| `normalizedOutcome` / `outcome` | Outcome labels |
| `reconciliationRequired` | Flag |
| `retry` / `retryable` | Flags |

Pre-existing operational identifiers remain allow-listed (`gateway`, `idempotencyKey`, `gatewayPaymentId`, `paymentId`, …). See [logging.md](../../core/docs/logging.md).

Still redacted by substring patterns (unless exact allow-list hit): `secret`, `token`, `card`, `email`, `phone`, `authorization`, `clientSecret`, `cvv`, `pan`, `name`, `address`, `signature`, `hmac`, etc.

**Do not** broaden the allow-list for PII field names. Prefer opaque ids over customer data.

## What is and is not redacted

- Free-form **event name** strings on `emit` (same residual as log **messages** — do not put secrets in the event string).
- **Structured telemetry bags** go through `createRedactingTelemetrySink` / `redactTelemetryData` (core `redact()` + operational-key restore).
- **Metric labels and span attributes (OBS-1 honesty):** the in-package metric registry (`createInMemoryPaymentMetrics`), the OTEL bridge (`createOpenTelemetryBridge`), and `withPaymentOperation` **do** auto-redact via `redactAttributeBag` as defense-in-depth (custom tracers used *through* `withPaymentOperation` do not see raw secret-shaped `internalReference`). Still set only non-sensitive primitives — a custom `PaymentMetrics` / a `PaymentTracer` started outside instrumentation may not scrub, and redaction is key/pattern based (not a full DLP guarantee for free-form values).
- Error **messages** are intentionally not attached by default in instrumentation (only `errorName` may be set). Span `recordException` is sanitized to name + non-secret `code` only (secret-shaped codes such as `sk_live_x` are dropped) so raw exception text never reaches OTEL exporters.

## Double-wrapping

`createRedactingTelemetrySink` is idempotent in effect (redacting already-redacted bags is a no-op for secrets), but prefer a single wrap at the composition root:

```typescript
// Good — wrap once when building GatewayContext / instrumentation options
const telemetry = createRedactingTelemetrySink(appSink);

// Avoid — unnecessary double wrap at every call site
withPaymentOperation(
  {
    context,
    // withPaymentOperation already wraps; raw sink is fine here
    telemetry: createRedactingTelemetrySink(createRedactingTelemetrySink(appSink)),
  },
  fn,
);
```

Note: `withPaymentOperation` always wraps the provided `telemetry` sink before emit so secrets never leave that path even if the app forgets to wrap.

## GatewayContext

```typescript
import { createDefaultGatewayContext } from "@paykernel/core";

const ctx = createDefaultGatewayContext({
  telemetry: {
    emit(event, data) {
      /* … */
    },
  },
});
// ctx.telemetry is already wrapped with createRedactingTelemetrySink
```

`TelemetrySink` remains **optional** and additive for 0.x compatibility. `createDefaultGatewayContext` wraps a provided sink the same way gateways wrap loggers — pre-wrapping is still safe (double-wrap does not unmask secrets).
