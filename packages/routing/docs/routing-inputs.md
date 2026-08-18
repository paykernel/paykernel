# Routing inputs

Phase **21.1** input surface for pure select-time matching.

- **`RoutingInput`** — what the app passes to `router.select(input)`.
- **`RouteMatchCriteria`** — what each `route(match).to(gateway)` rule constrains.

Unspecified fields are **wildcards**. When a criterion is set on a rule, it must match the input (**AND** of all specified fields).

## `RoutingInput`

| Field | Type | Role |
| --- | --- | --- |
| `currency` | `string?` | Payment currency (matched case-insensitively after trim). Must agree with Money / `amountCurrency` when both are set |
| `country` | `string?` | Country / market code (CI after trim) |
| `paymentMethod` | `string?` | Method id (e.g. `mada`, `card`) (CI after trim) |
| `amount` | `{ amount: string; currency: string } \| string?` | Money for range checks — **string decimals**, not floats |
| `amountCurrency` | `string?` | Required when `amount` is a plain decimal string |
| `tenant` | `string?` | Exact tenant id match when the rule sets `tenant` |
| `tenantConfig` | `Record<string, string \| number \| boolean>?` | Exact equality for each key required by the rule |
| `requiredCapabilities` | `readonly string[]?` | Capabilities the selected gateway must claim `true` (also usable on rules) |
| `merchantPreference` | `string?` | Preferred gateway id (boost among matches; rule may also hard-require it) |
| `health` | `Record<string, number \| boolean>?` | Select-time health filter per gateway id |
| `cost` | `Record<string, number \| string>?` | Optional cost scores (lower preferred among matches) |
| `gatewayCapabilities` | `Record<string, Partial<Record<string, boolean>>>?` | Capability snapshot per gateway (app-built) |
| `excludeGateways` | `readonly string[]?` | Gateways to skip (attempted set / post-attempt alternate) |

Optional keys use `exactOptionalPropertyTypes` semantics: **omit** absent keys; do not assign `undefined`.

```typescript
import type { RoutingInput } from "@paykernel/routing";

const input: RoutingInput = {
  currency: "SAR",
  paymentMethod: "mada",
  amount: { amount: "100.00", currency: "SAR" },
  tenant: "acme",
  requiredCapabilities: ["payments"],
  gatewayCapabilities: {
    moyasar: { payments: true },
    stripe: { payments: true },
  },
  health: { moyasar: true, stripe: 0.9 },
  cost: { moyasar: "1.0", stripe: "1.2" },
};
```

## `RouteMatchCriteria` (on `route(match)`)

| Field | Match when specified |
| --- | --- |
| `currency` | Case-insensitive equality after trim vs `input.currency` (and vs Money / `amountCurrency` when those are set) |
| `country` | Case-insensitive equality after trim vs `input.country` |
| `paymentMethod` | Case-insensitive equality after trim vs `input.paymentMethod` |
| `amountMin` / `amountMax` | Inclusive major-unit decimal range in `amountCurrency` |
| `amountCurrency` | **Required** when either bound is set; compared to input amount currency |
| `tenant` | Exact string equality vs `input.tenant` |
| `tenantConfig` | Exact equality for **every** specified key vs `input.tenantConfig` |
| `requiredCapabilities` | All keys `true` on `input.gatewayCapabilities[rule.gateway]` |
| `merchantPreference` | Case-insensitive trim match vs `input.merchantPreference` (hard filter on that rule; ROUTE-2) |

Empty match `{}` is a **catch-all** rule (still subject to health / exclude / capability filters at select time).

```typescript
import { route } from "@paykernel/routing";

route({ currency: "SAR", paymentMethod: "mada" }).to("moyasar");
route({
  currency: "USD",
  amountMin: "0.50",
  amountMax: "10000.00",
  amountCurrency: "USD",
}).to("stripe");
route({
  tenant: "acme",
  tenantConfig: { plan: "pro" },
  requiredCapabilities: ["payments", "refunds"],
}).to("stripe");
```

## Wildcards

- Field omitted on the **rule** → that dimension does not constrain (wildcard).
- Field set on the rule but **missing** on the input → **no match** (fail-closed for that criterion).
- Missing capability map for a gateway that requires capabilities → **no match** (fail-closed).

## Money-safe amount ranges

Amount comparisons **never** use floating-point `Number` equality for money.

1. Resolve input amount via `resolveInputAmount` to major-unit decimal + currency.
2. Convert bounds and input with core **`toMinorUnits`** → `bigint`.
3. Inclusive: `min ≤ amount ≤ max`.

| Situation | Result |
| --- | --- |
| Rule has no `amountMin`/`amountMax` | Wildcard (range always passes) |
| Range without `amountCurrency` on the rule | No match |
| Input amount missing / unresolvable | No match |
| Rule currency ≠ input currency | No match (no silent accept) |
| Invalid / unparseable decimal | No match (matcher fails closed; no float coercion) |
| Complementary amount-split + `fallback` (e.g. Stripe ≤99.99 + PayPal ≥100) | Each amount matches one rule. After excluding one bucket, the other rule’s range honesty-blocks select-time fallback (`NoRouteMatchError`). Fail-closed — see [selection.md](./selection.md#select-time-fallback-not-post-attempt). |
| Complementary currency / country / method / tenant + `fallback` (e.g. USD→stripe + EUR→adyen, or acme→stripe + globex→adyen) | Each value matches one rule. After excluding the matching bucket, complementary partitions honesty-block unconstrained fallback (`NoRouteMatchError`, not stripe). Unmatched values (GBP / unknown tenant) may still use fallback. |
| `input.currency` ≠ Money / `amountCurrency` (both present) | No match. Select throws `NoRouteMatchError` (`currency_mismatch_honesty`). Fallback is not used. |

Helpers exported for advanced use / tests: `amountInRange`, `resolveInputAmount`, `compareDecimalAmounts`.

```typescript
// Preferred input shapes
amount: { amount: "10.50", currency: "SAR" }
// or
amount: "10.50", amountCurrency: "SAR"
```

## Health (select-time only)

```typescript
health?: Record<string, number | boolean>
```

| Signal | Behavior |
| --- | --- |
| missing map or missing gateway key | Treated as **healthy** |
| `false` | Exclude gateway |
| `true` | Healthy |
| `number < healthThreshold` | Exclude (default threshold `1`) |
| non-finite number | Exclude |

Configure threshold on the router: `createPaymentRouter({ healthThreshold: 0.8, ... })`.

**Important:** health only filters **at select time**. It does not auto-jump to another gateway after a failed or indeterminate attempt — that is a separate eligibility check ([safe-fallback.md](./safe-fallback.md)).

## Cost (optional ranking among matches)

```typescript
cost?: Record<string, number | string>
```

When `cost` is present on the input, among criteria-matching healthy candidates:

1. Sort by ascending cost score
2. Then by gateway id
3. Then by original rule index

Scores are ranking values (numbers or base-10 decimal strings). Missing / unparseable → sorted last (`+Infinity`). This is **not** a money conversion path.

When `cost` is **absent**, selection keeps original rule-array order (first match wins among remaining candidates).

## Merchant preference

Two related behaviors:

| Location | Effect |
| --- | --- |
| `input.merchantPreference` | Soft **boost**: among matching candidates, prefer gateways equal to preference; if none match preference, keep full candidate set |
| `match.merchantPreference` on a rule | Hard **filter**: rule matches only when input preference equals that value |

## Capabilities

Build `gatewayCapabilities` in the app from core snapshots (`defineGatewayCapabilities` / `supports` / gateway manifests). Routing does **not** import adapters.

- Rule-level `requiredCapabilities` take precedence when set; otherwise input-level `requiredCapabilities` apply to the rule’s gateway.
- Fail-closed: missing map for the candidate gateway → rule does not match.
- Select-time `fallback` is also checked against input-level `requiredCapabilities` when those are set.

Capability keys align with core `GatewayCapabilityKey` strings (e.g. `"payments"`, `"refunds"`). Routing treats them as opaque strings for matching.

## Excluded gateways

`excludeGateways` removes those ids from rule candidates and from select-time fallback. Used by `trySelectFallbackGateway` so already-attempted gateways are not reselected.

## Related

- [selection.md](./selection.md) — evaluation order and `createPaymentRouter`
- [safe-fallback.md](./safe-fallback.md) — post-attempt eligibility (separate from health)
- Core money: [`packages/core/docs/money.md`](../../core/docs/money.md)
- Core capabilities: [`packages/core/docs/gateway-capabilities.md`](../../core/docs/gateway-capabilities.md)
