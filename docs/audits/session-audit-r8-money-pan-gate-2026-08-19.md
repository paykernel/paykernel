# Session-audit r8 leftover C-R8-FINGERPRINT-MONEY-PAN (2026-08-19)

**Kind:** leftover critic / fix / gate of **C-R8-FINGERPRINT-MONEY-PAN**  
**Workflow:** `.grok/workflows/paykernel-r8-money-pan-fix-gate.rhai`  
**Original finding:** [`session-audit-r8-diff-critic-2026-08-19.md`](./session-audit-r8-diff-critic-2026-08-19.md)  
**r8 source of truth:** [`session-audit-2026-08-19-r8.md`](./session-audit-2026-08-19-r8.md)  
**Prior r8 gate (not this verdict):** [`session-audit-r8-fix-gate-2026-08-19.md`](./session-audit-r8-fix-gate-2026-08-19.md) — closed S20 billing / otp / Visa-vs-MC / 13-digit *id* collisions; this leftover is the money-collision half after hashed PAN-like **values**.  
**Working tree:** uncommitted session-audit (r8) diffs. Do **not** commit. Do **not** push.

**Method:** re-read current production source (`read_file` / `grep`). Trace `fingerprintParams` → `redactForFingerprint` → `isFingerprintMoneyAmountLeaf` → `stableStringify` / `tryCanonicalAmountCurrency` / `money()`. Independently executed `fingerprintParams` on JPY 1e12 `money()` / decimal string / number / trailing-zero, plus billing / otp / Visa-vs-MC / 13-digit allow-listed ids / amount-without-currency. Tests in `utils.test.ts` are evidence only. Did not treat implement summaries as evidence. Did not invent extras.

| Field | Value |
| --- | --- |
| `ok` | **true** — leftover hole closed; gate passed |
| `confirmed_count` | **0** — leftover critic found no new identity split / inverted skip / dead-code regression |
| `gate_pass` | **true** |
| Scope | `packages/core/src/utils/idempotency.ts` and `packages/core/src/utils/money.ts` (workflow allow-list). Logger `redact` is out of scope and stays constant `[REDACTED]`. |

Intended leftover behavior is **not** a bug: skip value-level PAN hashing for Money amount leaves when `key === "amount"` and sibling `currency` is a string, so money-canonicalization can collapse economically identical JPY 1e12 forms to one SHA-256. Keep hashing true PAN / OTP / billing keys. Do not PAN-hash allow-listed ids. Amount without sibling currency still PAN-hashes. C1 and r7 S19 closes stay closed. Pre-existing `depth > 6` constant `"[REDACTED]"` is not this leftover.

---

## Original leftover (now closed)

r8 `redactForFingerprint` hashed opaque-sensitive **string** leaves (logger `isOpaqueSensitiveString` / embedded 13–19 digit runs) **before** `stableStringify` money-canonicalization. `amount` is in the logger `SAFE_KEY_ALLOWLIST`, so it is not a sensitive **key**, but a 13-digit `Money.amount` (JPY exponent 0, `1e12` is a safe integer) is a PAN-like **value**. `hashedFingerprintLeaf` digested the **raw** string; `isMoney` / `tryCanonicalAmountCurrency` then failed on `[REDACTED:…]`, so number vs string vs trailing-zero bags of the same economic amount split.

That was **not** S20-FINGERPRINT-REDACT (billing / otp / Visa-vs-MC / 13-digit *id* collisions). Those stay closed.

**Required close:** skip value-level PAN hashing for money amount leaves (`amount` + sibling string `currency`), **or** canonicalize money **before** PAN hashing. Keep hashing PAN / OTP / billing. Do not PAN-hash allow-listed ids. Do not constant-replace PII. Four-way JPY 1e12 must share one SHA-256; raw digits must not appear in the persisted digest **string**.

---

## Critic (leftover src)

Walked `fingerprintParams`, `redactForFingerprint`, `isFingerprintMoneyAmountLeaf`, `tryCanonicalAmountCurrency`, `stableStringify`, and `money()` for inverted skip, identity split, and dead code.

Current skip is the intended one:

```336:389:packages/core/src/utils/idempotency.ts
/**
 * Money majors can be 13–19 digits (JPY 1e12). Value-level PAN hashing
 * before {@link stableStringify} canonicalize would split number vs string
 * vs trailing-zero bags of the same economic amount (C-R8-FINGERPRINT-MONEY-PAN).
 */
function isFingerprintMoneyAmountLeaf(
  key: string,
  parent: Record<string, unknown>,
): boolean {
  return key === "amount" && typeof parent.currency === "string";
}

function redactForFingerprint(value: unknown, depth = 0): unknown {
  // ...
    if (typeof val === "string" && isOpaqueSensitiveFingerprintString(val)) {
      // Allow-listed ids: 13–19 digit values are gateway ids, not PANs.
      // Money amount leaves: let stringify collapse number / string / trailing-zero.
      out[key] =
        (isFingerprintIdentityKey(key) && isDigitRunId(val)) ||
        isFingerprintMoneyAmountLeaf(key, record)
          ? val
          : hashedFingerprintLeaf(val);
```

`fingerprintParams` still hashes **after** `redactForFingerprint` (PII stays out of the digest plaintext). Money collapse still runs in `stableStringify` / `tryCanonicalAmountCurrency` on intact amount leaves. Number bags never entered the string-PAN branch; string / trailing-zero / `Money.amount` now skip hashing when sibling `currency` is a string, so all four reach the same canonical `{ amount: "1000000000000", currency: "JPY" }`.

Sensitive **keys** (`email` / `otp` / `card` / `number` / …) still `hashedFingerprintLeaf`. Allow-listed identity keys with 13–19 digit runs stay plaintext leaves. `{ amount: "1000000000000" }` has no sibling `currency` string, so it is still PAN-hashed.

**Confirmed leftover findings sent to fix:** none (`confirmed_count = 0`). No additional `idempotency.ts` / `money.ts` edit in this leftover pass.

---

## Fix

Skipped — critic confirmed 0. Close was already in current source (`isFingerprintMoneyAmountLeaf` + trailing-zero remainder strip from S20-TRAILING-ZERO so `"1000000000000.0"` parses as JPY).

---

## Gate

Independent `bun` probe of `fingerprintParams` (not the unit test):

| Input | SHA-256 |
| --- | --- |
| `money(1e12, "JPY")` | `04040a57146056a8d750f5bb32aa7e51dc7ba8d562a1637b718bce73e066691e` |
| `{ amount: "1000000000000", currency: "JPY" }` | same |
| `{ amount: 1000000000000, currency: "JPY" }` | same |
| `{ amount: "1000000000000.0", currency: "JPY" }` | same |

All four share **one** SHA-256. Digest is a 64-char hex string and does **not** contain `1000000000000`. `{ amount: "1000000000001", currency: "JPY" }` is distinct.

S20 identity still holds on the same probe:

- two `paymobBillingData` bags (distinct email / name / phone) do **not** share a fingerprint
- `{ otpValue: "1111" }` vs `{ otpValue: "2222" }` do **not** share a fingerprint
- Visa `4111111111111111` vs Mastercard `5555555555554444` do **not** share a fingerprint; raw PAN digits are not in the digest string
- allow-listed 13-digit `gatewayPaymentId` / `orderId` / `paymentId` are **not** PAN-hashed (distinct ids stay distinct; `fingerprintParams({ gatewayPaymentId: "1234567890123" })` equals `sha256Hex(stableStringifyParams(…))`)
- `{ amount: "1000000000000" }` **without** sibling `currency` is still hashed (not equal to `sha256Hex(stableStringifyParams({ amount: "1000000000000" }))`)

Logger `redact` is unchanged (constant `[REDACTED]`). Persisted fingerprint is still `sha256Hex(…)` (S19-FINGERPRINT).

`utils.test.ts` `C-R8-FINGERPRINT-MONEY-PAN` locks the same four-way plus amount-without-currency hashing.

---

## Blocking

*(empty — C-R8-FINGERPRINT-MONEY-PAN is closed)*

---

## Non-blocking (not this leftover)

None of these restore the JPY 1e12 identity split or the original S20 billing / otp / Visa-vs-MC / 13-digit *id* lie:

- `redactForFingerprint` at `depth > 6` still returns constant `"[REDACTED]"` (named in the r8 gate; explicitly out of this leftover).
- `packages/webhooks/docs/webhook-inbox.md` post-claim `fulfill(ctx.event)` paste; `packages/core/src/index.ts` JSDoc “when `event.status === 'paid'`”; bulk `claimDue` API; Paymob `mapPaymobOutcome` explicit `failed` → `declined`.

C1 (unexpanded `latest_charge` + `amount_received > 0` stays `paid`) and r7 S19 ship-gate closes were not reopened.

---

## Verdict

**Pass.** `confirmed_count = 0`. `gate_pass = true`. JPY 1e12 `money()` / string / number / trailing-zero all share SHA-256 `04040a57146056a8d750f5bb32aa7e51dc7ba8d562a1637b718bce73e066691e`. Billing, OTP, and Visa-vs-MC still do not collide; allow-listed 13-digit ids are not PAN-hashed; amount without sibling currency is still hashed. **C-R8-FINGERPRINT-MONEY-PAN is closed.**

Do **not** commit. Do **not** push.
