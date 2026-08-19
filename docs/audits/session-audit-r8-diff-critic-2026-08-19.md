# Session-audit r8 diff critic (2026-08-19)

**Kind:** read-only critic of uncommitted r8 session-audit production src  
**Workflow:** `.grok/workflows/paykernel-r8-diff-critic.rhai`  
**Source of truth for intended r8 behavior:** [`session-audit-2026-08-19-r8.md`](./session-audit-2026-08-19-r8.md)  
**Gate artifact (not this verdict):** [`session-audit-r8-fix-gate-2026-08-19.md`](./session-audit-r8-fix-gate-2026-08-19.md)  
**Working tree:** uncommitted session-audit (r8) diffs. Do **not** commit. Do **not** push.

**Method:** re-read current production source (`read_file` / `grep`). Trace `fingerprintParams` → `redactForFingerprint` → `stableStringify` / `tryCanonicalAmountCurrency` / `money()`. Did not treat gate/implement summaries as evidence. Did not invent extras.

| Field | Value |
| --- | --- |
| `ok` | **false** — one confirmed r8 identity regression |
| `confirmed_count` | **1** |
| Scope | production src under `packages/` and `examples/checkout-kernel/src` (workflow allow-list). Tests/docs are evidence only. |

Intended r8 behavior is **not** a bug: hashed PII leaves, allow-listed ids not PAN-hashed, logger stays constant `[REDACTED]`, `setup_completed` → `succeeded`, bare `failed` without `decline` → `failed`, reclaim `ifMatchPayloadHash`, heartbeat `closed`, memory `get()` read-only, Redis empty ifMatch reject, list wipe on issuer clock, sqlite explicit path, PayPal unknown refund 200 → `pending`, Paymob redirect terminals → `processing`, amount-only refund only when `fromStatus` undefined, trailing-zero money, retry NaN sanitize. C1 and r7 S19 closes stay closed. Pre-existing r7 code is not a finding.

---

## Confirmed (1)

### C-R8-FINGERPRINT-MONEY-PAN

**File:** `packages/core/src/utils/idempotency.ts`  
**Sev:** fence / idempotency identity (r8 S20-FINGERPRINT-REDACT residual)  
**Not the original S20 lie:** billing / otp / Visa-vs-MC / 13-digit *id* collisions are closed. This is a **new** hole the r8 leaf-hash introduced against the “economically identical money still collides” invariant.

`fingerprintParams` hashes after `redactForFingerprint`, **before** `stableStringify` money-canonicalization:

```218:224:packages/core/src/utils/idempotency.ts
export function fingerprintParams(value: unknown): string {
  return sha256Hex(
    stableStringify(
      redactForFingerprint(stripAbortSignalsForFingerprint(value)),
    ),
  );
}
```

`redactForFingerprint` PAN-hashes any opaque-sensitive string leaf (logger `isOpaqueSensitiveString` via `redact(value) === "[REDACTED]"`) unless the **key** is in `FINGERPRINT_IDENTITY_KEYS` **and** the value is a 13–19 digit run:

```341:377:packages/core/src/utils/idempotency.ts
function redactForFingerprint(value: unknown, depth = 0): unknown {
  // ...
    if (typeof val === "string" && isOpaqueSensitiveFingerprintString(val)) {
      // Allow-listed ids: 13–19 digit values are gateway ids, not PANs.
      out[key] =
        isFingerprintIdentityKey(key) && isDigitRunId(val)
          ? val
          : hashedFingerprintLeaf(val);
      continue;
    }
    out[key] = redactForFingerprint(val, depth + 1);
```

`amount` is in the **logger** key allow-list (`SAFE_KEY_ALLOWLIST` in `logger.ts`) so `isSensitiveFingerprintKey("amount")` is false. It is **not** in `FINGERPRINT_IDENTITY_KEYS`. A 13–19 digit `Money.amount` (or any bag `amount` string that is PAN-like / contains an embedded 13–19 digit run) is therefore `hashedFingerprintLeaf`’d.

`hashedFingerprintLeaf` digests the **raw** string (`stableStringify(value)` of that leaf), not the canonical major-unit form. After that, `isMoney` / `tryCanonicalAmountCurrency` fail: `parseDecimalString("[REDACTED:…]")` is not a decimal, so the money-collapse in `stableStringify` never runs.

JPY exponent is 0 (`getCurrencyExponent("JPY") === 0`). `money(1e12, "JPY")` is a safe integer (`1e12` ≤ `Number.MAX_SAFE_INTEGER`) and canonicalizes to `{ amount: "1000000000000", currency: "JPY" }` — **13 digits**, which `isOpaqueSensitiveString` treats as a PAN.

Traced identity (same economic 1e12 JPY):

| Input | After `redactForFingerprint` | Canonical money path | Fingerprint class |
| --- | --- | --- | --- |
| `money(1e12, "JPY")` | `amount` → `[REDACTED:` + sha256(`"1000000000000"`) + `]` | skipped (`isMoney` false) | hashed leaf A |
| `{ amount: "1000000000000", currency: "JPY" }` | same hashed leaf A | skipped | **collides with row 1** |
| `{ amount: 1000000000000, currency: "JPY" }` | number left intact (`typeof !== "string"`) | `tryCanonicalAmountCurrency` → `"1000000000000"` | **distinct** (plain canonical money) |
| `{ amount: "1000000000000.0", currency: "JPY" }` | hashed leaf of the **raw** `"1000000000000.0"` (`containsEmbeddedPan` matches the 13-digit run; `.` is not stripped first) | skipped | **distinct** from A and from the number bag |

S20-TRAILING-ZERO would accept `"1000000000000.0"` as JPY (unused `.0` remainder stripped) **if** canonicalization ran first. It does not.

`utils.test.ts` “still collides economically identical money while hashing PII” only locks `10.50` / `10.500` USD (too short to be PAN-like). Visa/MC tests use `amount: 10` (number). No test covers a 13–19 digit major-unit string vs number / trailing-zero string.

**Required (not done in this critic):** skip value-level PAN hashing for money amount leaves (`amount` / nested `Money.amount`), **or** run money-canonicalization **before** PAN hashing so economically identical amounts share one leaf. Keep hashing true PAN / OTP / billing keys. Do not PAN-hash allow-listed ids. Do not constant-replace PII (S20-FINGERPRINT-REDACT stays closed). Flip a test: `money(1e12,"JPY")`, `{amount:"1000000000000",currency:"JPY"}`, `{amount:1000000000000,currency:"JPY"}`, and `{amount:"1000000000000.0",currency:"JPY"}` must share one SHA-256; raw digits must not appear in the digest **string** (the persisted value is still `sha256Hex(stableStringify(redacted))`).

---

## Reviewed, not confirmed

Walked the r8 allow-list for **new** mistakes (logic / dead code / fence regressions). None of the following is a confirmed finding:

- `operation-result.ts`: `setup_completed` in `isSettledSuccessStatus`; `outcomeForFailedStatus` requires `decline`. Intended.
- `retry.ts`: `sanitizeMaxAttempts` finite ≥ 1. Intended.
- `money.ts`: trailing-zero remainder strip. Intended. Not the fingerprint order bug.
- PayPal `mapRefundStatus` unknown HTTP 200 → `pending`. Intended.
- Paymob `redirectEnvelopeStatus` non-pending/processing → `processing`. Intended.
- `webhook-event-map.ts` amount-only refund only when `fromStatus` undefined; redirect dual-write demote. Intended.
- Webhooks `bestEffortRecordFailAfterLeaseLost` `ifMatchPayloadHash`; engine/scheduler heartbeat `closed`. Intended.
- Memory `get()` read-only; Redis empty ifMatch reject; list wipe issuer clock; sqlite open requires path. Intended.

**Not reported (gate leftovers / not new r8 lies):** `redactForFingerprint` `depth > 6` still constant `"[REDACTED]"`; `claimDue` still returns N live leases; Paymob `mapPaymobOutcome` explicit `failed` → `declined`; docs paste in `webhook-inbox.md` / `index.ts` JSDoc. Those were already named in the r8 gate result.

---

## Verdict

**Not clean.** `confirmed_count = 1`: r8 hashed PAN-like **values** (correct for billing/otp/card) also hash `Money.amount` 13–19 digit strings **before** money-canonicalization, so large zero-decimal amounts (JPY 1e12 class) no longer share a fingerprint across `Money` / decimal string / number / trailing-zero string. S20-FINGERPRINT-REDACT’s PII collision close is intact; the money-collision half of that ID is not.

Do **not** treat this file as a fix. Do **not** commit.
