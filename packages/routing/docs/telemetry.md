# Routing telemetry

Phase 21 (A3): the selected gateway must stay **visible** on the decision, in payment execution, and in operation context / telemetry attributes.

## `RoutingDecision.gateway`

Every successful `select` returns a decision with a non-empty `gateway` string:

```typescript
const decision = router.select(input);
// decision.gateway is always set on success

await payments.createPayment(params, decision.gateway);
```

Do **not** hide gateway choice inside the router or collapse it away before logging. Downstream metrics and spans need the same id the app used for the attempt.

## `decisionToTelemetryAttributes`

Maps a decision to **non-sensitive** attributes only:

```typescript
import { decisionToTelemetryAttributes } from "@paykernel/routing";
import type { RoutingTelemetryAttributes } from "@paykernel/routing";

const attrs: RoutingTelemetryAttributes =
  decisionToTelemetryAttributes(decision);

// attrs.gateway       — always present
// attrs.matched
// attrs.usedFallback
// attrs.reason        — RoutingDecisionReason union
// attrs.ruleIndex?    — omitted when absent (exactOptionalPropertyTypes)
```

| Attribute | Source | Sensitive? |
| --- | --- | --- |
| `gateway` | `decision.gateway` | No — gateway id |
| `matched` | `decision.matched` | No |
| `usedFallback` | `decision.usedFallback` | No |
| `reason` | `decision.reason` | No — stable code |
| `ruleIndex` | `decision.ruleIndex` | No — index only |

### Never included

`decisionToTelemetryAttributes` **does not** emit:

- `tenantConfig` contents
- `health` / `cost` maps
- Secrets, tokens, card data, raw request/response payloads
- Full `RoutingInput` dumps

Keep routing decision logs free of secret leakage (mandatory rule 4).

## OperationContext.gateway

Core `OperationContext` requires `gateway`. Pass the **same** id as `decision.gateway`:

```typescript
import {
  createOperationContext,
  finalizeOperationContext,
  operationContextToTelemetryData,
  createRedactingTelemetrySink,
} from "@paykernel/core";
import {
  createPaymentRouter,
  route,
  decisionToTelemetryAttributes,
} from "@paykernel/routing";

const router = createPaymentRouter({
  rules: [route({ currency: "USD" }).to("stripe")],
  fallback: "stripe",
});

const decision = router.select({ currency: "USD" });

const started = createOperationContext({
  operationId: crypto.randomUUID(),
  gateway: decision.gateway, // A3 — same id used for createPayment
  operationType: "payment.create",
});

const result = await payments.createPayment(params, decision.gateway);

const finished = finalizeOperationContext(started, {
  durationMs: /* measured */,
  normalizedOutcome: result.outcome /* or inferred */,
});

const sink = createRedactingTelemetrySink({
  emit(event, data) {
    // app metrics / logs
  },
});

sink.emit?.("payment.routing", decisionToTelemetryAttributes(decision));
sink.emit?.("payment.operation", operationContextToTelemetryData(finished));
```

## Composition with observability (optional)

`@paykernel/routing` does **not** depend on `@paykernel/opentelemetry`. Apps may compose:

```text
App composition root
  ├── createPaymentRouter(...)
  ├── decision = router.select(...)
  ├── decisionToTelemetryAttributes(decision)  → metrics labels / span attrs
  ├── createOperationContext({ gateway: decision.gateway, ... })
  └── withPaymentOperation / PaymentMetrics (from observability package)
```

Metric and span attribute rules from Phase 20 still apply: no secret labels; keep `indeterminate` honest when recording outcomes after an attempt.

## Post-attempt visibility

When evaluating fallback eligibility, log **submission state** and **eligibility reason**, not secret payloads:

```typescript
const state = classifySubmissionState({ error: err });
const eligibility = evaluateFallback({ submissionState: state });

sink.emit?.("payment.fallback.eligibility", {
  submissionState: eligibility.submissionState,
  allowed: eligibility.allowed,
  reason: eligibility.reason,
  // do NOT attach raw error bodies, headers, or tenant secrets
});
```

If an alternate gateway is selected, emit attributes for **both** attempted and alternate gateways so ops can see the path without guessing.

## Related

- Core telemetry / OperationContext: [`packages/core/docs/telemetry.md`](../../core/docs/telemetry.md)
- Observability package: [`packages/observability/docs/overview.md`](../../observability/docs/overview.md)
- [selection.md](./selection.md) · [safe-fallback.md](./safe-fallback.md)
