# Routing overview

**Phase 21** package: safe, deterministic gateway **selection** for payment systems built on [`@paykernel/core`](https://www.npmjs.com/package/@paykernel/core).

Package: **`@paykernel/routing`** · path: `packages/routing`

## Purpose

Choose a gateway with **explicit ordered rules**. The package does **not** execute payments, and it does **not** automatically switch gateways after an unsafe or indeterminate attempt.

| Surface | Role |
| --- | --- |
| **Rules** | `route(match).to(gateway)` — currency, country, method, amount range, tenant, capabilities, merchant preference |
| **Select** | `createPaymentRouter` + pure `select(input)` → `RoutingDecision` with `gateway` always set on success |
| **Select-time fallback** | Optional `fallback` when no rule matches (**not** post-attempt recovery) |
| **Post-attempt eligibility** | `isSafeFallbackEligible` / `evaluateFallback` / `classifySubmissionState` — default-deny except not submitted / definitive pre-submit failure |
| **Telemetry** | `decisionToTelemetryAttributes(decision)` — non-sensitive gateway + match metadata |

## Package boundary

```text
@paykernel/routing
  └── depends on @paykernel/core (core) only

MUST NOT depend on:
  testkit · adapters · webhooks · reconciliation · observability · frameworks

Core MUST NOT depend on this package (boundary inversion forbidden).
```

| Rule | Meaning |
| --- | --- |
| Portable | `paymentsSdk.portable: true` — no `node:`, `bun:`, or `cloudflare:` in production sources |
| Select-only | Router never calls `createPayment` / capture / refund / network I/O |
| Visible gateway | `RoutingDecision.gateway` always present on success; pass into `createPayment` and `OperationContext.gateway` |
| No secret logs | Telemetry attributes exclude `tenantConfig` dumps, secrets, PII, health/cost maps |
| Money-safe | Amount ranges use core `toMinorUnits` (bigint) — never `Number` float compare |

See monorepo policy: [`docs/workspace-boundaries.md`](../../../docs/workspace-boundaries.md).

## Compose with PaymentClient (A3)

Selection is app-composed. Pass `decision.gateway` into core — the router never hides which gateway was chosen:

```typescript
import {
  createPaymentRouter,
  route,
  decisionToTelemetryAttributes,
} from "@paykernel/routing";
import { createOperationContext } from "@paykernel/core";

const router = createPaymentRouter({
  rules: [
    route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar"),
    route({ currency: "USD" }).to("stripe"),
  ],
  fallback: "stripe", // select-time only
});

const decision = router.select({
  currency: params.currency,
  paymentMethod: params.paymentMethod,
  amount: { amount: params.amount, currency: params.currency },
});

// Selected gateway stays visible end-to-end
const ctx = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: decision.gateway,
  operationType: "payment.create",
});

await payments.createPayment(params, decision.gateway);
// telemetry: decisionToTelemetryAttributes(decision)
void ctx;
```

## Design rules (summary)

1. **Select ≠ execute** — pure, sync `select`.
2. **Deterministic first-match** — same rules + input → same decision (rule array order is significant).
3. **Select-time `fallback` only** — default gateway when no rule matches; never post-attempt recovery.
4. **Post-attempt default-deny** — only `not_submitted` / `pre_submission_failure` are auto-eligible.
5. **Never after indeterminate / timeout / connection_reset / uncertain 5xx / submitted** without a loud expert override.
6. **Expert override is opt-in** — `{ confirmUnsafeFallback: true, reason }` only; never defaulted; bare `true` rejected.
7. **No secret telemetry** — gateway + match metadata only.

## Non-goals

- Automatically retrying or routing an **indeterminate** payment to another gateway (roadmap non-goal; duplicate-charge risk)
- Router-owned mutation retries (capture / refund via router)
- Framework adapters, hosted checkout, disputes, marketplace, customers, new PSPs (Phase 22+)
- Hard dependency on `@paykernel/opentelemetry` — apps compose telemetry at the root

## Related docs

| Doc | Content |
| --- | --- |
| [routing-inputs.md](./routing-inputs.md) | `RoutingInput` / match criteria, wildcards, money-safe ranges, health/cost |
| [selection.md](./selection.md) | `createPaymentRouter`, first-match, select-time fallback, select vs execute |
| [safe-fallback.md](./safe-fallback.md) | Submission states, eligibility, expert override, non-goal |
| [telemetry.md](./telemetry.md) | `decision.gateway`, `decisionToTelemetryAttributes`, OperationContext |
| [matching.md](./matching.md) | Short alias of evaluation order (points at inputs + selection) |
