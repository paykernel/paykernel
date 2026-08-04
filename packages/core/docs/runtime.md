# Runtime Portability (Phase 8)

`@paykernel/core` is designed to run on **Node ≥ 18**, **Bun ≥ 1**,
**Deno**, and **Cloudflare Workers** using Web APIs (`fetch`, `TextEncoder`,
`AbortController`, Web Crypto) and pure portable crypto helpers. Production
sources and the published `dist/index.js` entry **do not** static-import
`node:crypto`, `node:buffer`, or other Node builtins.

Related: [plugin-architecture.md](./plugin-architecture.md),
[behavioral-contracts.md](./behavioral-contracts.md) §7,
[webhooks.md](./webhooks.md).

---

## PaymentRuntime

Injectable, **secret-free** dependency bag for portable HTTP and crypto:

```ts
import {
  createPaymentRuntime,
  createPaymentClient,
  stripeGateway,
  type PaymentRuntime,
  type Clock,
} from "@paykernel/core";

const runtime: PaymentRuntime = createPaymentRuntime({
  // optional partial overrides
  fetch: customFetch,
  clock: { now: () => new Date(0), nowMs: () => 0 },
});

const client = createPaymentClient({
  gateways: {
    stripe: stripeGateway({ secretKey: process.env.STRIPE_SECRET_KEY! }),
  },
  runtime: {
    fetch: customFetch,
    clock: runtime.clock,
  },
});
```

| Field | Default | Notes |
| --- | --- | --- |
| `fetch` | Live-delegating `globalThis.fetch` | Gateways use `this.fetch` / context fetch — not bare `fetch(...)` at call sites |
| `crypto` | Web Crypto (`globalThis.crypto`) | `CryptoProvider`: `randomUUID`, `getRandomValues`, optional `subtle` |
| `clock` | `Date` / `Date.now` | `Clock`: `now()` / `nowMs()` (Stripe webhook skew uses clock) |
| `randomUUID` | `crypto.randomUUID` | Fallback via `getRandomValues` when needed |

Helpers:

| Export | Role |
| --- | --- |
| `createPaymentRuntime(partial?)` | Build full runtime with portable defaults |
| `mergePaymentRuntime(base, partial?)` | Overlay partial fields |
| `paymentRuntimeFromContext(ctx)` | Project runtime fields from `GatewayContext` |
| `systemClock` | Default wall clock |
| `resolveDefaultCrypto` | Web Crypto provider resolution |
| `uuidV4FromGetRandomValues` | UUID v4 from `getRandomValues` only |

**Never** put API keys, webhook secrets, DB handles, request objects, or PII on
`PaymentRuntime` / `GatewayContext`.

### `exactOptionalPropertyTypes`

Omit optional keys instead of assigning `undefined`:

```ts
// Good
createPaymentClient({ gateways, runtime: { fetch: mockFetch } });

// Avoid
createPaymentClient({
  gateways,
  runtime: { fetch: mockFetch, clock: undefined },
});
```

---

## GatewayContext

`GatewayContext` **extends** `PaymentRuntime` and adds client-owned fields:

| Field | Role |
| --- | --- |
| `hooks` | Shared `HooksManager` |
| `logger` | Prefer redacting logger |
| `uuid()` | Convenience alias of `randomUUID` (0.x) |
| `telemetry?` | Optional sink (no PII/secrets) — prefer `createRedactingTelemetrySink` |

`createDefaultGatewayContext({ runtime?, fetch?, crypto?, clock?, … })` builds
defaults via `createPaymentRuntime`. Nested `runtime` is merged under top-level
PaymentRuntime fields. Optional `telemetry` is attached only when provided
(`exactOptionalPropertyTypes`-safe: omit the key when absent).

Built-in factories (`stripeGateway`, …) forward context runtime into gateway
constructors so HTTP uses the injected `fetch`.

### Telemetry (Phase 20)

`PaymentRuntime` itself is **fetch / crypto / clock / randomUUID only** — it does
**not** carry a telemetry bag (by design). Optional diagnostics live on
`GatewayContext.telemetry` and on structured `OperationContext` builders.

```ts
import {
  createDefaultGatewayContext,
  createRedactingTelemetrySink,
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
  systemClock,
} from "@paykernel/core";

const telemetry = createRedactingTelemetrySink({
  emit(event, data) {
    // app-owned backend
    console.info(event, data);
  },
});

const ctx = createDefaultGatewayContext({
  telemetry,
  // clock remains the portable duration source (no node:perf_hooks)
  clock: systemClock,
});

const started = createOperationContext({
  operationId: ctx.randomUUID(),
  gateway: "stripe",
  operationType: "payment.create",
});
const startMs = ctx.clock.nowMs();
// … work …
const finished = finalizeOperationContext(started, {
  durationMs: Math.max(0, ctx.clock.nowMs() - startMs),
  normalizedOutcome: "succeeded",
  providerRequestId: "req_abc", // allow-listed for debugging
});
ctx.telemetry?.emit?.(
  "payment.operation",
  operationContextToTelemetryData(finished),
);
```

Rules:

| Rule | Detail |
| --- | --- |
| Optional / additive | `TelemetrySink` stays optional for 0.x compatibility |
| Redact by default | Prefer `createRedactingTelemetrySink` (same `redact()` as logs) |
| No secrets on context | Never put API keys, webhook secrets, card data, or raw payloads on runtime/context/telemetry bags |
| No OTEL in core | Metrics / optional OTEL bridge live in `@paykernel/opentelemetry` |
| Portable duration | Use injectable `Clock.nowMs()` / `Date.now` — never `node:perf_hooks` |

Full core guide: [telemetry.md](./telemetry.md). Metrics, spans, and
`withPaymentOperation`: [`@paykernel/opentelemetry`](../../observability/README.md).
Shared redaction allow-list: [logging.md](./logging.md).

---

## Portable crypto (sync webhooks)

Pure implementations (no `node:crypto`, no npm crypto deps) keep
`verifyWebhook` **synchronous** on Workers / Deno / Bun / Node:

| Helper | Use |
| --- | --- |
| `sha256Hex` / `sha256` | Payload digests (`hashWebhookPayload`) |
| `sha512Hex` / `sha512` | Digest helpers |
| `hmacSha256Hex` / `hmacSha256` | Stripe-style webhook signatures |
| `hmacSha512Hex` / `hmacSha512` | Paymob-style webhook signatures |
| `timingSafeEqualBytes` / `timingSafeEqualHex` | Signature compare |
| `utf8Encode`, `bytesToHex`, `hexToBytes` | Encoding |
| `bytesToBase64`, `base64ToBytes`, `utf8ToBase64` | Basic auth / tokens (no `Buffer`) |
| `concatBytes` | Portable `Buffer.concat` |

Strategy: pure sync HMAC/SHA for 0.x sync `verifyWebhook`. Optional Web Crypto
`subtle` remains on `CryptoProvider` for future async paths. Phase 7
`hashWebhookPayload` uses portable `sha256Hex` (redacted canonical JSON).

### Stripe verify example (portable)

```ts
import {
  createPaymentClient,
  stripeGateway,
  hmacSha256Hex,
} from "@paykernel/core";

const secret = process.env.STRIPE_WEBHOOK_SECRET!;
const client = createPaymentClient({
  gateways: {
    stripe: stripeGateway({
      secretKey: process.env.STRIPE_SECRET_KEY!,
      webhookSecret: secret,
    }),
  },
});

// Prefer handleWebhook on the client; low-level:
const rawBody = /* exact request body string */;
const sig = request.headers.get("stripe-signature") ?? undefined;
const ok = client.gateway("stripe").verifyWebhook(rawBody, sig);
```

---

## HTTP timeouts and AbortSignal

Built-in gateways cancel in-flight provider HTTP with a **timeout** signal
(`AbortController` + `setTimeout`, or `AbortSignal.timeout` where PayPal uses it).

- Config knobs: per-gateway `timeoutMs` (defaults are provider-specific).
- Timeouts surface as **`NetworkError`** (indeterminate for money mutations —
  do not treat as definite failure; see [behavioral-contracts.md](./behavioral-contracts.md) §1).
- Injected `runtime.fetch` must honor `RequestInit.signal` for timeouts to work.

Built-ins combine a **caller** `AbortSignal` (when present on operation params)
with the timeout via public helpers:

| Export | Role |
| --- | --- |
| `combineAbortSignals(...signals)` | Fan-in (`AbortSignal.any` or portable polyfill) |
| `createTimeoutSignal(timeoutMs)` | Timeout handle + `clear()` |
| `extractAbortSignal` / `stripAbortSignal` / `withAbortSignal` | Params helpers (`exactOptionalPropertyTypes`-safe) |
| `isAbortError` / `mapHttpAbortError` | Classify abort vs timeout → `PaymentAbortedError` / `NetworkError` |

Timeouts remain **indeterminate** for money mutations (never auto-mapped to
paid/failed). Prefer timeout config when you only need a deadline.

---

## Injecting custom fetch / clock / crypto

### Mock fetch in tests

```ts
import {
  createPaymentClient,
  stripeGateway,
  createDefaultGatewayContext,
} from "@paykernel/core";

const fetchCalls: string[] = [];
const mockFetch: typeof fetch = async (input, init) => {
  fetchCalls.push(String(input));
  return new Response(JSON.stringify({ id: "pi_test", status: "succeeded" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const client = createPaymentClient({
  gateways: {
    stripe: stripeGateway({ secretKey: "sk_test_…" }),
  },
  runtime: { fetch: mockFetch },
});

// Or build context for registry.createAll:
const ctx = createDefaultGatewayContext({ fetch: mockFetch });
```

**Note:** Defaults delegate to **live** `globalThis.fetch` (not a frozen
snapshot), so tests that only patch `globalThis.fetch` after construction still
work. Prefer explicit `runtime.fetch` for deterministic harnesses.

### Fake clock (webhook skew)

```ts
const fixedMs = Date.parse("2020-01-01T00:00:00.000Z");
const client = createPaymentClient({
  gateways: {
    stripe: stripeGateway({
      secretKey: "sk_test_…",
      webhookSecret: "whsec_…",
    }),
  },
  runtime: {
    clock: {
      now: () => new Date(fixedMs),
      nowMs: () => fixedMs,
    },
  },
});
// Stripe 5-minute signature window uses clock.nowMs()
```

For richer clocks in app tests, `@paykernel/testkit` also exposes
`createFakeClock` (testkit-only; core does not depend on testkit).

### Custom crypto / UUID

```ts
createPaymentRuntime({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
  crypto: {
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    getRandomValues: (arr) => {
      /* fill arr */ return arr;
    },
  },
});
```

---

## Supported runtimes

| Runtime | Engines / notes | Status |
| --- | --- | --- |
| **Node** | `>=18` (min); LTS 18 / 20 / 22 recommended | CI: Node 20 typecheck/test/build + consumer smoke |
| **Bun** | `>=1.0.0` | CI: Bun 1.2.x install/test/build + consumer smoke |
| **Deno** | Modern Deno with npm/file import of ESM | Optional smoke when `deno` is on PATH; else static `node:` gate |
| **Cloudflare Workers** | Workerd-compatible Web APIs | Static: published `dist` must have **zero** `node:` imports; functional smoke via unit tests + injected fetch |

`package.json` `engines`:

```json
{
  "node": ">=18",
  "bun": ">=1.0.0"
}
```

Single ESM export entry (portable):

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

Build uses `bun build --target node --format esm --packages external` after a
clean `dist/`. The published bundle must not force Node builtins; portability
CI fails if `node:` appears in production sources or `dist/**/*.js`.

---

## Runtime matrix (what CI runs vs aspirational)

### Required in CI / `validate:package`

| Check | Command / location |
| --- | --- |
| Production src has no `node:` / banned bare builtins | `bun run check:runtime-portability` (`scripts/check-runtime-portability.ts`) |
| Published `dist/**/*.js` has no `node:` imports | same (Workers/Deno gate) |
| Unit tests for checker | `bun test scripts/check-runtime-portability.test.ts` (via `bun run test:runtime`) |
| Workspace portable policy | `bun run check:boundaries` (empty `node:` allowlist for portable prod) |
| Consumer install + functional smoke | `scripts/consumer-smoke.mjs` — Bun **and** Node against packed tarball: import, `createPaymentRuntime`, portable Stripe `verifyWebhook`, injected fetch context |
| Typecheck / tests / build / publint / attw | `bun run validate:package` |

### Optional / SKIP-tolerant

| Check | Behavior |
| --- | --- |
| Deno import of `dist/index.js` | Runs only if `deno` is on PATH; missing binary is **SKIP**, not failure |
| workerd / miniflare / wrangler | **Not** required; no heavy deps. Prefer static `node:` scan + unit tests |
| Multi-version matrix (Node 18 + latest LTS, Bun min + latest) | Documented as aspirational; CI pins Bun 1.2.x + Node 20 for speed |

### How to run locally

```bash
bun run build
bun run check:runtime-portability   # src + dist scan (+ Deno if installed)
bun run test:runtime                # checker unit tests + portability CLI
bun run validate:package            # full gate including consumer-smoke
```

---

## What is NOT supported

| Not supported | Why |
| --- | --- |
| **Browsers with secret keys** | Secret keys, webhook secrets, and money mutations are **server-side only**. Do not ship this package with secrets to client bundles. |
| CommonJS `require()` | ESM-only package (`exports.import` only). |
| Node &lt; 18 | Needs global `fetch` / `AbortController` / modern ESM. |
| Relying on `Buffer` / `node:crypto` in **portable production** code paths | Use pure helpers and `Uint8Array` / `TextEncoder`. Tests may still use `node:crypto` for fixtures. |
| Framework coupling | No Express/Hono/Elysia types in core. |
| Secrets on `PaymentRuntime` | Context is secret-free by contract. |

---

## Design rules (Phase 8 + Phase 20 telemetry)

1. No secrets on `PaymentRuntime` / `GatewayContext`.
2. Prefer Web APIs (`fetch`, `TextEncoder`, `AbortController`, Web Crypto).
3. Production `packages/core/src` must not static-import `node:` builtins
   (tests may).
4. Global `fetch` remains the default — injecting runtime is opt-in.
5. Gateways use injected `this.fetch` when context/runtime is available.
6. Never convert uncertain transport outcomes into definite payment failure.
7. `verifyWebhook` stays synchronous where possible (0.x).
8. `exactOptionalPropertyTypes`: omit optional keys; do not assign `undefined`.
9. Optional `telemetry` is additive only; prefer redacting sinks (Phase 20).
10. Core has no `@opentelemetry/*` dependency; observability is optional and external.

---

## Status checklist

- [x] `PaymentRuntime` + `Clock` + public exports
- [x] `createPaymentClient({ runtime })` → `createDefaultGatewayContext`
- [x] Pure portable HMAC/SHA + encoding helpers
- [x] `hashWebhookPayload` without `node:crypto`
- [x] Built-in gateways use injected `fetch` / clock / crypto from runtime
- [x] Operation `signal?: AbortSignal` + combine with timeout (Stream C)
- [x] Published dist + src portability scan (`check:runtime-portability`)
- [x] Consumer smoke: Node + Bun import + portable Stripe webhook verify
- [x] Docs: this guide, contracts §7, plugin architecture, engines note
- [x] Phase 20: optional `TelemetrySink` + `OperationContext` (no OTEL in core; see [telemetry.md](./telemetry.md))
- [ ] Optional multi-version CI matrix (Node 18 + latest, Bun min + latest)
- [ ] Optional workerd functional smoke (no heavy deps in core)

### Operation cancellation (Stream C)

Every network operation accepts optional `signal?: AbortSignal` on params
(`CreatePaymentParams`, `CaptureParams`, `RefundParams`, `VoidParams`,
`GetPaymentParams`, checkout session params, Moyasar STC OTP confirm).

```ts
const controller = new AbortController();
const payment = client.createPayment({
  amount: 10,
  currency: "USD",
  callbackUrl: "https://example.com/cb",
  signal: controller.signal,
});
// cancel in-flight provider HTTP
controller.abort();
```

Helpers (package root): `combineAbortSignals`, `createTimeoutSignal`,
`mapHttpAbortError`, `extractAbortSignal` / `stripAbortSignal` / `withAbortSignal`.

Gateways merge **caller signal + timeout** on every HTTP call. Multi-request
flows reuse the same caller signal. Timeout-only behavior is unchanged when
`signal` is omitted. Caller abort → `PaymentAbortedError`; timeout →
`NetworkError` (not indeterminate money failure from abort alone).
