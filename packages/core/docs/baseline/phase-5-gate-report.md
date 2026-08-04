# Phase 5 adversarial gate report

**Date (UTC):** 2026-08-02  
**Packages:** `@paykernel/core@0.8.0` (core), `@paykernel/testkit@0.1.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Implementer claims under review

| Claim | Independent result |
| --- | --- |
| typecheck (core + testkit) | **PASS** — `bun run typecheck` exit 0 (both workspace filters) |
| typecheck:types | **PASS** — `bun run typecheck:types` exit 0 |
| 868 tests (core + testkit) | **PASS** — `bun test packages/core packages/testkit` → **868 pass, 0 fail**, 3361 expects, 28 files |
| coverage 98.63% lines / 99.28% funcs | **PASS** — measured **98.63% lines / 99.28% funcs** (`bun test --coverage packages/core`) |
| build + dist money.d.ts | **PASS** — `bun run build` exit 0; `packages/core/dist/utils/money.d.ts` present; core `index.js` ~255 KB |
| boundaries | **PASS** — `bun run check:boundaries` → workspace boundaries OK |
| validate:package (pack/publint/attw/smoke) | **PASS** — full `bash scripts/validate-package.sh` OK |
| Money primitives exported | **PASS** — root `src/index.ts` re-exports types + runtime helpers; `public-api.test.ts` freezes surface |
| `toMinorUnits` is bigint | **PASS** — overloads return `MinorAmount` (`bigint`); edge suite asserts `typeof v === "bigint"` |
| default rounding reject | **PASS** — `options?.rounding ?? "reject"`; excess digits throw `InvalidRequestError` |
| all 4 gateways use utils/money; no Math.round / amount*float paths | **PASS** — each gateway imports shared helpers; grep of gateway `.ts` shows no money `Math.round` / `amount * 100` float conversion |
| AmountInput `number \| Money` still tested | **PASS** — type + runtime tests; gateway Money create paths covered |
| 5.4 edge suite + docs/money.md + JSON plain-object Money | **PASS** — `money.edge.test.ts`, `docs/money.md`, JSON round-trip asserts `{"amount":"…","currency":"…"}` |
| No code fixes needed | **Accepted** — independent re-run all green; no logical bugs found under Phase 5 anti-patterns |
| verify failures `[]` / ok `true` | **Accepted** — independent re-run all green (not trusted alone) |

---

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun test packages/core packages/testkit` | **868 pass, 0 fail** (28 files, 3361 expects) |
| `bun test --coverage packages/core` | **786 pass**; **99.28% funcs / 98.63% lines**; thresholds met (lines ≥ 0.90, funcs ≥ 0.85) |
| `bun run typecheck` | exit 0 (core + testkit) |
| `bun run typecheck:types` | exit 0 |
| `bun run check:boundaries` | exit 0 |
| `bash scripts/validate-package.sh` | typecheck → typecheck:types → test → build → pack → publint → attw → consumer smoke **OK** |
| dist money declarations | `packages/core/dist/utils/money.d.ts` present after build; implementation bundled into `dist/index.js` (no separate `money.js` — expected for package entry bundle) |
| core → testkit dep | **none** — core `dependencies` = `{ zod }` only |

### Static / source audits

| Audit | Result |
| --- | --- |
| `Math.round` / `amount * 100` float money conversion in `packages/core/src` | **None** in conversion code; only docs/comments, retry backoff (`Math.pow` on delay), and time `* 1000` (ms) |
| Gateway money conversion path | All four: `normalizeAmountInput` → `toMinorUnits` (bigint) → `minorAmountToNumber` (safe range) or canonical string format |
| `money.ts` self-audit test | Edge suite strips comments and asserts no `Math.round`, no float `* 10 ** n` / `* 100` |

---

## Acceptance criteria (roadmap Phase 5)

### A1) No financial calculation relies on binary floating point — **PASS**

| Evidence | Detail |
| --- | --- |
| Shared conversion | `packages/core/src/utils/money.ts`: string/bigint scale via `scaleToMinor` / `formatMinorAsDecimal`; `10n ** BigInt(exponent)` only |
| Default reject | Excess fractional digits throw under `rounding: "reject"` (default) |
| Number input path | Deprecated: `numberToDecimalString` then same string rules; `0.1 + 0.2` fails reject (tested) |
| Provider boundary | `minorAmountToNumber` throws outside `Number.MAX_SAFE_INTEGER` — no silent unsafe `Number(bigint)` |
| Gateways | Moyasar / Stripe / PayPal / Paymob all call shared helpers for major↔minor; no gateway-local `amount * 100` float scale |
| 0.x result majors | Result fields still expose major-unit `number` via `moneyToMajorNumber` (documented legacy shape; not used for conversion) |

### A2) JSON serialization remains straightforward — **PASS**

| Evidence | Detail |
| --- | --- |
| Public shape | `Money = { readonly amount: DecimalString; readonly currency: TCurrency }` — strings only |
| No bigint on Money | Edge test: keys `["amount","currency"]`; `typeof amount === "string"` |
| Round-trip | `JSON.stringify(money("10.50","SAR"))` → `'{"amount":"10.50","currency":"SAR"}'`; parse + `toMinorUnits` equal |
| Docs | `packages/core/docs/money.md` documents plain-object JSON behavior |

### A3) Every gateway uses shared conversion primitives — **PASS**

| Gateway | Import / use |
| --- | --- |
| Moyasar | `normalizeAmountInput`, `toMinorUnits`, `fromMinorUnits`, `minorAmountToNumber`, `moneyToMajorNumber` |
| Stripe | same + explicit `stripeCurrencyExponent` / three-decimal ÷10 after bigint scale |
| PayPal | same + `money()` for provider decimal strings; format via shared minor path |
| Paymob | same + `getCurrencyExponent(..., currencyExponentOverrides)` as explicit `exponent` |

---

## Phase 5 tasks 5.1–5.4

### 5.1 Introduce Money primitives — **PASS**

Present and exported:

- `Money`, `DecimalString`, `MinorAmount` (`bigint`)
- `getCurrencyExponent` / `normalizeCurrencyCode` + `CurrencyExponentOverrides`
- Provider overrides via options / gateway-local exponent maps (not ISO-collapsed)
- Parsing/formatting: `parseDecimalString`, `money()`, `toMinorUnits`, `fromMinorUnits`, `formatMoney`
- Factory matches roadmap Target API: `money("10.50", "SAR")` → `{ amount, currency }`

### 5.2 Validate precision strictly — **PASS**

- Default rounding `'reject'`
- Explicit modes: `half_up`, `half_even`, `floor`, `ceil`, `trunc`
- Covered in `money.test.ts` + `money.edge.test.ts`

### 5.3 Migrate amount fields (0.x) — **PASS**

- `AmountInput = number | Money` still accepted
- Deprecated number path stringifies carefully + strict validation
- Migration docs: `packages/core/docs/money.md` (preferred string/Money; float noise fails; results remain number until 1.0)
- Type tests: `public-api.types.test.ts` accepts both forms

### 5.4 Test currency edge cases — **PASS**

`money.edge.test.ts`, `money.provider-profiles.test.ts`, and per-gateway Money path tests (`*.gateway.test.ts`) cover:

- Zero- / two- / three-decimal currencies
- Large values beyond `MAX_SAFE_INTEGER` (bigint kept; `minorAmountToNumber` throws)
- Invalid precision reject-by-default
- Exponent overrides (e.g. OMR:2)
- Intentional negative marketplace (`allowNegative`)
- Rounding modes, JSON plain object, no-float invariant, case-insensitive currency

### Phase 0–4 safety net + boundaries — **PASS**

- Full core+testkit suite green (includes prior-phase coverage)
- `check:boundaries` OK
- No core → testkit dependency

### Logical bug scan (fail closed) — **PASS (none found)**

| Anti-pattern | Status |
| --- | --- |
| Silent rounding by default | **Absent** — default `reject` |
| Float conversion leftover in gateways | **Absent** — shared bigint path only |
| Unsafe `Number(bigint)` | **Guarded** — `minorAmountToNumber` range check |
| Money with bigint fields | **Absent** — public Money is string pair only |
| Broken Stripe three-decimal rules | **Intact** — minor must be divisible by 10 after scale |
| Ignored Paymob overrides | **Intact** — `currencyFractionDigits` uses `getCurrencyExponent` + config overrides; invalid overrides throw (tested) |

---

## Non-blocking notes

1. **`money.ts` file-level line coverage (~89%)** is below package aggregate because many throw-only branches are sparse; aggregate **98.63% lines / 99.28% funcs** still clears policy floors. Not a Phase 5 acceptance failure.
2. **0.x result amounts remain major-unit `number`** via `moneyToMajorNumber` — intentional per roadmap 5.3 / docs; consumers should not ledger from float majors. Phase 6+ / 1.0 may switch results to `Money`.
3. **Post-gate cleanup:** dead `amountInputToMajorNumber` and YAGNI arithmetic exports were removed; gateways remap via `MoneyAmountError.kind` instead of English regex.
4. **No separate `dist/utils/money.js`** — runtime is bundled into `dist/index.js`; declaration file `money.d.ts` is emitted for types consumers. Matches validate:package pack list.

---

## Checklist summary

| ID | Criterion | Result |
| --- | --- | --- |
| A1 | No float finance calc | PASS |
| A2 | JSON-friendly Money | PASS |
| A3 | All gateways share primitives | PASS |
| 5.1 | Money primitives + exponents + factory | PASS |
| 5.2 | Reject excess precision by default | PASS |
| 5.3 | 0.x number + Money + migration docs | PASS |
| 5.4 | Edge suite (0/2/3, large, overrides, negatives) | PASS |
| Safety | typecheck / tests / coverage / build / boundaries / validate | PASS |
| Bugs | No silent round / float leftover / unsafe Number / bigint Money / Stripe÷10 / Paymob overrides | PASS |

---

## Verdict

**PASS** — Phase 5 Safe Money Model acceptance criteria and tasks 5.1–5.4 are independently verified. No blocking defects. No code fixes required from this gate.
