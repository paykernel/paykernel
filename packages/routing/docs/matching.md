# Matching semantics

> Canonical docs: **[routing-inputs.md](./routing-inputs.md)** (fields, wildcards, money, health/cost) and **[selection.md](./selection.md)** (first-match evaluation, select-time fallback).

## Evaluation order (summary)

1. Collect all rules whose **match criteria** and **capability** checks pass, and whose gateway is **healthy** and not in `excludeGateways`.
2. Among candidates:
   - If `input.merchantPreference` is set and any candidate gateway equals it, restrict to those.
   - If `input.cost` is provided, sort by ascending cost, then gateway id, then rule index.
   - Otherwise keep original rule-array order.
3. Pick the first remaining candidate (**deterministic**).
4. If none: use select-time `fallback` if configured and usable **and** no amount-range / capability / complementary currency-country-method-tenant honesty-block / currency-mismatch honesty-block applies; else throw `NoRouteMatchError` (fail-closed). Complementary amount-split rules (Stripe ≤X + PayPal ≥X+ε plus a fallback) and complementary currency / country / method / tenant partitions (USD→stripe + EUR→adyen, or acme→stripe + globex→adyen, plus a fallback) always honesty-block that fallback after one bucket is excluded — there is no post-attempt recovery through `fallback`. `input.currency` disagreeing with Money / `amountCurrency` is also fail-closed. See [selection.md](./selection.md).

**First matching rule wins** when cost/preference are not used. Rule array order is significant.

## Criteria (AND of specified fields)

| Criterion | Match when specified |
| --- | --- |
| `currency` | Case-insensitive equality after trim vs `input.currency`; Money / `amountCurrency` must also agree when set |
| `country` | Case-insensitive equality after trim |
| `paymentMethod` | Case-insensitive equality after trim |
| `amountMin` / `amountMax` | Inclusive range via `toMinorUnits` bigint in `amountCurrency` |
| `tenant` | Exact string equality |
| `tenantConfig` | Exact equality for every specified key |
| `requiredCapabilities` | All keys `true` on `gatewayCapabilities[gateway]` (fail-closed if map missing) |
| `merchantPreference` (on rule) | Case-insensitive trim match to `input.merchantPreference` |

Unspecified criteria are **wildcards**. See [routing-inputs.md](./routing-inputs.md) for full tables, money-safe range edge cases, health, and cost.

## Related

- [selection.md](./selection.md)
- [safe-fallback.md](./safe-fallback.md)
