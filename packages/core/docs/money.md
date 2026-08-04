# Safe Money Model (Phase 5)

This document describes the shared money primitives in `@paykernel/core`:
`Money`, decimal-string major units, bigint minor units, rounding policies, and
0.x migration from plain `number` amounts.

## Why

JavaScript `number` is IEEE-754 binary floating point. Expressions like
`0.1 + 0.2` are not exactly `0.3`, and `amount * 100` is **not** a safe way to
convert major units to minor units. Phase 5 introduces a small JSON-friendly
money model and **requires** bigint-based conversion for financial math.

## Quick start

```ts
import {
  money,
  toMinorUnits,
  fromMinorUnits,
  formatMoney,
  normalizeAmountInput,
} from "@paykernel/core";

// Preferred: decimal string + ISO currency
const amount = money("10.50", "SAR");
// => { amount: "10.50", currency: "SAR" }  (frozen, JSON-serializable)

JSON.stringify(amount); // {"amount":"10.50","currency":"SAR"}

toMinorUnits(amount); // 1050n  (bigint minor units / halalas)
toMinorUnits("10", "JPY"); // 10n
toMinorUnits("1.234", "KWD"); // 1234n

fromMinorUnits(1050n, "SAR"); // { amount: "10.50", currency: "SAR" }
formatMoney(amount); // "10.50 SAR"
```

## Types

| Type | Role |
| --- | --- |
| `DecimalString` | Clean decimal text (`"10.50"`, `"100"`, `"-1.250"`) |
| `Money` | `{ readonly amount: DecimalString; readonly currency: string }` |
| `MinorAmount` | `bigint` integer minor units (internal / provider integer APIs) |
| `AmountInput` | `number \| Money` — create/capture/refund/checkout input union in 0.x |
| `MoneyRoundingMode` | `'reject' \| 'half_up' \| 'half_even' \| 'floor' \| 'ceil' \| 'trunc'` |
| `CurrencyExponentOverrides` | `Readonly<Record<string, number>>` merchant/provider maps |

**Public Money never carries `bigint`.** Minor units stay internal so
`JSON.stringify` works without custom replacers. When you need to store minors,
persist `minor.toString()`.

## Conversion rules

1. Parse major-unit **decimal strings** (or stringify deprecated `number` inputs carefully).
2. Resolve the minor-unit **exponent**:
   - explicit `options.exponent`, else
   - `options.exponentOverrides` via `getCurrencyExponent`, else
   - ISO 4217 tables in `getCurrencyExponent` (0 / 2 / 3).
3. Scale with **bigint** only — never `amount * 10 ** n` as a float result path.
4. Default **rounding is `reject`**: excess fractional digits throw
   `InvalidRequestError`.

### Examples

| Input | Currency | Result |
| --- | --- | --- |
| `money("10.50", "SAR")` | SAR (exp 2) | OK → `"10.50"` |
| `money("10.999", "SAR")` | SAR | **throws** (reject) |
| `money("10.999", "SAR", { rounding: "half_up" })` | SAR | `"11.00"` |
| `money("10.5", "JPY")` | JPY (exp 0) | **throws** |
| `money("1.234", "KWD")` | KWD (exp 3) | OK |
| `money("1.2345", "KWD")` | KWD | **throws** |

Canonical `Money.amount` is **minor-aligned**: padded to the currency exponent
(e.g. `"10.5"` → `"10.50"` for SAR; zero-decimal has no fractional part).

## Rounding policies

| Mode | Behavior |
| --- | --- |
| `reject` (default) | Throw on excess fractional digits |
| `half_up` | Round half away from zero on the first discarded digit ≥ 5 |
| `half_even` | Banker's rounding (ties to even) |
| `floor` | Toward −∞ |
| `ceil` | Toward +∞ |
| `trunc` | Toward 0 (drop excess digits) |

## Sign and zero

| Option | Default | Use |
| --- | --- | --- |
| `allowNegative` | `false` | Marketplace reverse splits (e.g. Moyasar) |
| `allowZero` | `false` | Providers that allow 0 minor units |

```ts
// Marketplace reverse split
money("-5.00", "SAR", { allowNegative: true });

// Explicit zero
money("0", "USD", { allowZero: true });
```

Negative amounts must stay **scoped** to flows that intentionally support them
(splits). Top-level charges remain non-negative by default.

## Provider exponent overrides

ISO lookup lives in `getCurrencyExponent`. **Provider deviations stay gateway-local**
and are passed into money helpers explicitly so differences are never hidden:

| Provider | Example divergence | How to express |
| --- | --- | --- |
| Stripe | ISK / UGX treated as two-decimal specials; MGA zero-decimal vs ISO 2 | Gateway-local tables → pass `exponent` / overrides into shared helpers |
| PayPal | HUF / JPY / TWD zero-decimal list | Same |
| Paymob | Merchant `currencyExponentOverrides` (e.g. `{ OMR: 2 }`) | `MoneyParseOptions.exponentOverrides` |

```ts
import { toMinorUnits, getCurrencyExponent } from "@paykernel/core";

// ISO default for OMR is 3
getCurrencyExponent("OMR"); // 3

// Merchant / account override
toMinorUnits("20.12", "OMR", { exponentOverrides: { OMR: 2 } }); // 2012n

// Explicit exponent (wins over ISO and overrides map)
toMinorUnits("10", "USD", { exponent: 0 }); // 10n
```

Invalid override values (non-integer or negative) **throw** — they are never
silently ignored when the key is present.

## 0.x migration from `number`

### Inputs (`CreatePaymentParams` / capture / refund / splits / checkout)

Dual-accept (`number | Money`) applies to:

- **Create / capture / refund** amount fields
- **Marketplace splits** (Moyasar split `amount`; may be negative where reverse splits apply)
- **Stripe Checkout** simple-session `CreateCheckoutSessionParams.amount` and
  line-item `priceData.amount` (major units; `priceData.amount` also allows **zero**
  for free trials — still dual-accept)

```ts
// Deprecated but still accepted
await client.createPayment({
  amount: 10.5,
  currency: "SAR",
  callbackUrl: "https://example.com/cb",
});

// Preferred
import { money } from "@paykernel/core";

await client.createPayment({
  amount: money("10.50", "SAR"),
  currency: "SAR",
  callbackUrl: "https://example.com/cb",
});

// Stripe Checkout (simple amount or line-item priceData.amount)
await stripe.createCheckoutSession({
  amount: money("100.00", "USD"),
  currency: "USD",
  successUrl: "https://example.com/success",
});
```

`AmountInput = number | Money`. Gateway code should normalize at the boundary:

```ts
import { normalizeAmountInput, toMinorUnits, minorAmountToNumber } from "@paykernel/core";

const m = normalizeAmountInput(params.amount, params.currency);
const minor = toMinorUnits(m); // bigint
// Provider APIs that need a JSON number (safe range only):
const stripeCents = minorAmountToNumber(minor);
```

### Results (`GatewayPaymentResult.amount`, etc.)

In **0.x**, result money fields remain major-unit **`number`** for shape
stability. They are derived via shared `fromMinorUnits` + safe conversion.
Do not treat them as exact decimal storage; prefer webhooks / minor units for
ledgering. A future 1.0 may switch result amounts to `Money`.

### Deprecated number rules

- Prefer **string** majors always.
- Clean decimals like `10.5` / `99.99` still work.
- Float noise (`0.1 + 0.2`) fails default `reject` precision checks — intentional.
- Values outside `Number.MAX_SAFE_INTEGER` must use decimal strings / bigint minors.
- `moneyToMajorNumber` exists only for legacy interop; document float risk.

## Helper reference

| Function | Purpose |
| --- | --- |
| `money(amount, currency, options?)` | Build canonical `Money` |
| `isMoney(value)` | Type guard |
| `toMinorUnits(...)` | Major → `bigint` minor |
| `fromMinorUnits(minor, currency, options?)` | Minor → `Money` |
| `normalizeAmountInput(input, currency, options?)` | `number \| Money` → `Money` (currency match required) |
| `validateMoney(value, options?)` | Re-parse unknown → canonical `Money` |
| `formatMoney(m)` | `"10.50 SAR"` |
| `minorAmountToNumber(minor)` | Safe bigint → number (throws if unsafe) |
| `moneyToMajorNumber(m)` | Legacy major `number` (float risk) |
| `MoneyAmountError` | Structured amount failure (`kind` for remapping) |
| `getCurrencyExponent(code, overrides?)` | ISO (+ overrides) exponent |
| `normalizeCurrencyCode(code)` | Trim + uppercase |

Invalid amounts throw `MoneyAmountError` (extends `InvalidRequestError`) with a
stable `kind` (`excess_precision`, `zero`, `negative`, `unsafe_range`,
`currency_mismatch`, `invalid_format`, …). Custom adapters should branch on
`kind`, not English messages. Messages never include secrets.

## What this does *not* do

- Does not collapse Stripe / PayPal / Paymob special currency tables into ISO-only lookup.
- Does not put `bigint` on public payment results in 0.x.
- Does not change webhook payloads or start Phase 6 outcome unions.
- Does not remove `number` amount acceptance in 0.x (deprecated path only).
