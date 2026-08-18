# Selection

Phase **21.2** select-only gateway choice.

## Select vs execute

| | Select (`router.select`) | Execute (`PaymentClient`) |
| --- | --- | --- |
| Package | `@paykernel/routing` | `@paykernel/core` |
| Side effects | **None** (pure, sync) | Provider network I/O |
| Returns | `RoutingDecision` | Payment / operation result |
| Gateway | Chooses id string | Uses id from app (`gateway?` arg or default) |

The router **never** calls `createPayment`, `capturePayment`, `refundPayment`, or any fetch. Apps compose:

```typescript
const decision = router.select(input);
await payments.createPayment(params, decision.gateway);
```

## Target API

```typescript
import {
  createPaymentRouter,
  route,
  NoRouteMatchError,
  isNoRouteMatchError,
} from "@paykernel/routing";

const router = createPaymentRouter({
  rules: [
    route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar"),
    route({ currency: "USD" }).to("stripe"),
  ],
  fallback: "stripe", // select-time default only
});

const decision = router.select({
  currency: "SAR",
  paymentMethod: "mada",
});
// decision.gateway === "moyasar"
// decision.matched === true
// decision.usedFallback === false
// decision.ruleIndex === 0
// decision.reason === "rule_match" | "rule_match_merchant_preference" | "rule_match_cost_tiebreak"
```

### `route(match).to(gateway)`

- Produces an immutable `RoutingRule` `{ match, gateway }`.
- Gateway id is trimmed; empty / whitespace-only throws.
- Optional match keys are omitted when absent (`exactOptionalPropertyTypes`).

### `createPaymentRouter(options)`

| Option | Default | Meaning |
| --- | --- | --- |
| `rules` | (required) | Ordered list of `RoutingRule` |
| `fallback` | omit | Select-time default gateway when no rule matches |
| `healthThreshold` | `1` | Numeric health signals below this exclude a gateway |

Returned `PaymentRouter`:

```typescript
type PaymentRouter = {
  select(input: RoutingInput): RoutingDecision;
  readonly rules: readonly RoutingRule[];
  readonly fallback: string | undefined;
  readonly healthThreshold: number;
};
```

## First-match determinism (A1)

Evaluation is **ordered and deterministic** for the same rules + input:

1. Walk `rules` in array order.
2. Skip gateways in `input.excludeGateways`.
3. Skip unhealthy gateways (`input.health` + `healthThreshold`).
4. Keep rules where `ruleMatches(rule, input)` is true (criteria + capabilities).
5. Among remaining candidates:
   - If `input.merchantPreference` is set and any candidate gateway equals it (**case-insensitive** after trim; ROUTE-2), **restrict** the pool to those.
   - If `input.cost` is provided, sort by ascending cost, then gateway id, then rule index; pick first.
   - Otherwise pick the **first candidate in original rule order**.
6. If no candidates: select-time fallback path (below).

**Rule array order matters.** Swapping two USD rules changes which gateway wins when cost/preference are not used. Object-key iteration is never used for rule order.

Stable `reason` codes:

| `reason` | When |
| --- | --- |
| `rule_match` | Matched rule; no preference/cost special-case on the chosen gateway |
| `rule_match_merchant_preference` | Chosen gateway equals `input.merchantPreference` |
| `rule_match_cost_tiebreak` | `input.cost` was used for ranking |
| `fallback` | Select-time `fallback` used after no rule match |

## Select-time fallback (not post-attempt)

`createPaymentRouter({ fallback })` is used **only** when no rule produces a candidate:

```typescript
createPaymentRouter({
  rules: [route({ currency: "SAR" }).to("moyasar")],
  fallback: "stripe",
});

router.select({ currency: "EUR" });
// → { gateway: "stripe", matched: false, usedFallback: true, reason: "fallback" }
```

Still applied at select-time fallback:

- `excludeGateways` (fallback excluded if listed)
- Health of the fallback gateway
- Input-level `requiredCapabilities` vs `gatewayCapabilities[fallback]` (fail-closed if missing)
- **Rule-level** `requiredCapabilities` from nearly-matching rules (ROUTE-2) — fallback must satisfy them

**Amount-range honesty (ROUTE-1 / P21-EXCLUDE-HONESTY / P21-AMOUNT-RESOLVE):** if **any** rule matches all **non-amount** criteria but the input amount is **outside** that rule’s inclusive min/max (same currency), select-time fallback is **not** used — `NoRouteMatchError` is thrown. Honesty still considers rules whose gateway is **excluded** or **unhealthy** (including post-attempt `attemptedGateways` / `excludeGateways` / health maps) — unconstrained fallback must not send `$50` to a default after excluding an `amountMin=100` rule. Missing, unparseable, or invalid amounts (e.g. JPY `"10.50"`) against a range whose currency is present (or inherited: string `amount` uses `input.currency` when `amountCurrency` is omitted) are also honesty violations. Range bounds without `amountCurrency` remain honesty violations (misconfigured money bounds). Cross-currency with a **resolvable** different currency is not an amount-honesty violation (other criteria; fallback may still apply).

**Complementary amount-split + fallback (ROUTE-1, fail-closed):** two (or more) rules that partition the same non-amount criteria by complementary ranges — e.g. Stripe `amountMax=99.99` and PayPal `amountMin=100` plus `fallback: "stripe"` — leave **no** honest select-time fallback after one bucket is excluded or unhealthy. `$150` matches PayPal; after `excludeGateways: ["paypal"]` (or `trySelectFallbackGateway` / `attemptedGateways`), Stripe’s complementary max still matches non-amount criteria and honesty-blocks unconstrained fallback. That is **intentional fail-closed**, not a missing recovery path: sending `$150` to a gateway you bounded at `$99.99` would lie about the money bound. `NoRouteMatchError` (`code: "no_route_match"`, `reason: "amount_range_honesty"`) is the documented outcome.

**Complementary currency / country / method partitions (NEW-ROUTE-1, fail-closed):** same honesty as amount-range. Two (or more) rules that partition the same other criteria by **currency**, **country**, or **paymentMethod** — e.g. Stripe `currency: "USD"` and Adyen `currency: "EUR"` plus `fallback: "stripe"` — leave **no** honest select-time fallback after the matching bucket is excluded or unhealthy. EUR matches Adyen; after `excludeGateways: ["adyen"]`, Stripe’s complementary USD rule still matches all non-currency criteria and honesty-blocks unconstrained fallback. Sending EUR to the USD gateway would lie about the partition. `NoRouteMatchError` (`reason: "complementary_currency_honesty"` / `complementary_country_honesty` / `complementary_method_honesty`). An input that is **not** in any configured bucket (e.g. GBP when only USD/EUR rules exist) may still use select-time fallback.

This is **not** post-attempt recovery. After a payment attempt, use [safe-fallback.md](./safe-fallback.md). If you need another gateway for amounts that already have a range rule, configure an overlapping / unbounded rule for that gateway, or pick the gateway explicitly in the app — do not expect `fallback` to bypass complementary splits.

**Capability honesty (ROUTE-2 / P21-EXCLUDE-HONESTY):** if **any** rule matches non-capability criteria (including amount) and declares `requiredCapabilities` that the select-time fallback gateway lacks, fallback is **not** used — even when that rule’s gateway is excluded or unhealthy.

If no usable fallback is available, throws **`NoRouteMatchError`** (`code: "no_route_match"`). The library never invents a gateway id.

**Do not conflate** this with post-attempt multi-gateway recovery. After a payment attempt, use [safe-fallback.md](./safe-fallback.md).

## `RoutingDecision`

```typescript
type RoutingDecisionReason =
  | "rule_match"
  | "rule_match_merchant_preference"
  | "rule_match_cost_tiebreak"
  | "fallback";

type RoutingDecision = {
  gateway: string;                 // always set on success — pass to createPayment (A3)
  matched: boolean;                // true when a configured rule matched
  usedFallback: boolean;           // true when config.fallback was used
  ruleIndex?: number;              // index of matched rule when matched
  reason: RoutingDecisionReason;   // stable machine-readable code
};
```

`gateway` remains usable for telemetry and `OperationContext.gateway` — see [telemetry.md](./telemetry.md).

## Errors

| Error | Code | When |
| --- | --- | --- |
| `NoRouteMatchError` | `no_route_match` | No rule match and no usable select-time fallback. `reason` distinguishes `no_usable_fallback` from amount / capability / complementary-partition honesty. |
| `UnsafeFallbackDeniedError` | `unsafe_fallback_denied` | Post-attempt path denied / no alternate (not thrown by `select` itself). Honesty `NoRouteMatchError` keeps its `reason` (not rewritten to `no_alternate_gateway`). |

Guards: `isNoRouteMatchError`, `isUnsafeFallbackDeniedError`, `isSelectHonestyReason`.

## Compose example (full)

```typescript
import { createPaymentClient } from "@paykernel/core";
import {
  createPaymentRouter,
  route,
  classifySubmissionState,
  evaluateFallback,
  trySelectFallbackGateway,
} from "@paykernel/routing";

const payments = createPaymentClient({
  /* gateways + defaultGateway */
});

const router = createPaymentRouter({
  rules: [
    route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar"),
    route({ currency: "USD" }).to("stripe"),
  ],
  fallback: "stripe",
});

async function charge(params: { amount: string; currency: string }) {
  const decision = router.select({
    currency: params.currency,
    amount: { amount: params.amount, currency: params.currency },
  });

  // A3: decision.gateway is the only gateway used for this attempt
  try {
    return await payments.createPayment(params, decision.gateway);
  } catch (err) {
    const state = classifySubmissionState({ error: err });
    const eligibility = evaluateFallback({ submissionState: state });
    if (!eligibility.allowed) {
      // timeout / indeterminate / submitted / … — do NOT auto-retry another gateway
      throw err;
    }
    // Safe only for not_submitted / pre_submission_failure
    const alt = trySelectFallbackGateway(
      router,
      {
        currency: params.currency,
        amount: { amount: params.amount, currency: params.currency },
      },
      eligibility,
      { attemptedGateways: [decision.gateway] },
    );
    return await payments.createPayment(params, alt.gateway);
  }
}
```

## Related

- [routing-inputs.md](./routing-inputs.md) — match fields, money, health, cost
- [safe-fallback.md](./safe-fallback.md) — post-attempt eligibility
- [telemetry.md](./telemetry.md) — decision visibility
