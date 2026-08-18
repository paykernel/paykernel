# @paykernel/routing

Portable **safe routing policies** for [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core): deterministic select-only gateway choice, money-safe amount ranges, and structurally restricted post-attempt fallback eligibility.

> **Portable.** No Node-only imports. Runtime: Bun / Node ≥ 18 / Deno / Workers (Web APIs). Depends only on `@paykernel/core`.

## Install

```bash
bun add @paykernel/routing @paykernel/core
# or: npm install @paykernel/routing @paykernel/core
```

## Quickstart

```typescript
import {
  createPaymentRouter,
  route,
  decisionToTelemetryAttributes,
  isSafeFallbackEligible,
  evaluateFallback,
  classifySubmissionState,
} from "@paykernel/routing";

const router = createPaymentRouter({
  rules: [
    route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar"),
    route({ currency: "USD" }).to("stripe"),
  ],
  fallback: "stripe", // select-time default only — NOT post-attempt recovery
});

const decision = router.select({
  currency: "SAR",
  paymentMethod: "mada",
  // If you pass Money, currency must match input.currency or select throws
  // NoRouteMatchError { reason: "currency_mismatch_honesty" }.
});

// Pass decision.gateway into createPayment + OperationContext (A3)
await payments.createPayment(params, decision.gateway);
// telemetry.emit("payment.routing", decisionToTelemetryAttributes(decision));
```

### With PaymentClient

```typescript
import { createPaymentClient } from "@paykernel/core";
import { createPaymentRouter, route } from "@paykernel/routing";

const payments = createPaymentClient({
  gateways: {
    /* registered gateways — e.g. stripe, moyasar */
  },
  defaultGateway: "stripe",
});

const router = createPaymentRouter({
  rules: [
    route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar"),
    route({ currency: "USD" }).to("stripe"),
  ],
  fallback: "stripe",
});

async function createRoutedPayment(params: {
  amount: string;
  currency: string;
  paymentMethod?: string;
}) {
  const decision = router.select({
    currency: params.currency,
    paymentMethod: params.paymentMethod,
    amount: { amount: params.amount, currency: params.currency },
  });

  // decision.gateway is always set — keep it on OperationContext.gateway / metrics
  return payments.createPayment(params, decision.gateway);
}
```

## Design rules

| Rule | Meaning |
| --- | --- |
| **Select ≠ execute** | `router.select` is pure/sync. It never calls `createPayment` / capture / refund. |
| **Deterministic** | Same rules + input → same decision (ordered first-match; optional cost/preference). |
| **Select-time fallback** | `fallback` is used only when no rule matches. |
| **Post-attempt default-deny** | After an attempt, only `not_submitted` / `pre_submission_failure` are safe to try another gateway. |
| **Never after indeterminate** | Timeout, connection reset, indeterminate, uncertain 5xx, submitted → no auto multi-gateway retry. |
| **Expert override opt-in** | Unsafe path requires `{ confirmUnsafeFallback: true, reason }` — never defaulted. |
| **Money-safe ranges** | Amount comparisons use `toMinorUnits` bigint — never float. |
| **Currency honesty** | If `input.currency` and `amount.currency` are both set and differ, `select` throws `NoRouteMatchError` (`currency_mismatch_honesty`). Pass `money()` or the same currency on both. Unconstrained fallback is not used. |
| **No secret telemetry** | `decisionToTelemetryAttributes` exposes only gateway + match metadata. |

## ⚠ Unsafe fallback warnings

**Do not** treat transport failures as safe multi-gateway retries:

- **Timeout** / **connection reset** / **uncertain 5xx** may have already submitted a charge.
- **AbortError** / abort codes classify as **`indeterminate`** by default (not fallback-eligible). Use `aborted_before_submit` only when cancel is known pre-submit.
- **Indeterminate** outcomes must **not** be auto-routed to another gateway (duplicate-charge risk; package non-goal).
- **`createPaymentRouter({ fallback })` is not recovery** after a failed attempt — it only fills in a gateway when **no rule matches** at select time.
- Automatic post-attempt switching is **default-deny**. Use `classifySubmissionState` + `evaluateFallback` before any alternate `select` / `createPayment`.
- Expert override is **loud and opt-in** only — never default it on in app code.

## Post-attempt fallback (restricted)

```typescript
const state = classifySubmissionState({ errorKind: "timeout" });
// state === "timeout" → NOT safe

if (isSafeFallbackEligible(state)) {
  // only not_submitted | pre_submission_failure
}

const eligibility = evaluateFallback({
  submissionState: state,
  // expertOverride: { confirmUnsafeFallback: true, reason: "ops confirmed no charge" },
});
// eligibility.allowed === false for timeout without override
```

Alternate selection (only when eligibility is safe). `trySelectFallbackGateway`
re-validates `isSafeFallbackEligible(submissionState)` and does **not** trust a
forged `{ allowed: true }` without `expertOverride: true`:

```typescript
import { trySelectFallbackGateway } from "@paykernel/routing";

const next = trySelectFallbackGateway(router, input, eligibility, {
  attemptedGateways: [decision.gateway],
});
await payments.createPayment(params, next.gateway);
```

## Package boundary

```text
@paykernel/routing
  └── depends on @paykernel/core (core) only

MUST NOT depend on:
  testkit · adapters · webhooks · reconciliation · observability · frameworks

Core MUST NOT depend on this package.
```

## Docs

| Doc | Description |
| --- | --- |
| [Overview](./docs/overview.md) | Purpose, boundaries, non-goals, compose sketch |
| [Routing inputs](./docs/routing-inputs.md) | 21.1 inputs, wildcards, money-safe ranges, health/cost |
| [Selection](./docs/selection.md) | `createPaymentRouter` / first-match / select-time fallback |
| [Safe fallback](./docs/safe-fallback.md) | 21.3 submission states, eligibility, expert override |
| [Telemetry](./docs/telemetry.md) | `decision.gateway`, `decisionToTelemetryAttributes`, OperationContext |

## License

MIT
