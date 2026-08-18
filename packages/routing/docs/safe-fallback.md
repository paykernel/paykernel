# Safe fallback

Two different “fallback” concepts exist. **Do not conflate them.**

## 1. Select-time fallback (`createPaymentRouter({ fallback })`)

Used only when **no rule matches** during pure `select`.

- Chooses a default gateway **id** before any payment attempt
- **Not** recovery after a payment attempt
- Still subject to health / exclude / capability checks when those are on the input

Full details: [selection.md](./selection.md).

## 2. Post-attempt fallback eligibility (Phase 21.3)

After you already tried a gateway, switching providers can **double-charge** if the first request may have been accepted by the provider.

This package exposes **decision-only** eligibility APIs. It does **not** automatically re-route or re-execute payments. The app must:

1. Classify submission state
2. Evaluate eligibility
3. Only then optionally call `trySelectFallbackGateway` + `createPayment` again

### Submission states

| `SubmissionState` | Auto-fallback eligible? | Notes |
| --- | --- | --- |
| `not_submitted` | **Yes** | Request never accepted by provider |
| `pre_submission_failure` | **Yes** | Definitive failure before submission (e.g. validation / config) |
| `submitted` | **No** | Provider may have the payment |
| `indeterminate` | **No** | Outcome unknown — non-goal to auto-route |
| `timeout` | **No** | May have reached provider |
| `connection_reset` | **No** | May have reached provider |
| `provider_5xx_uncertain` | **No** | Uncertain 5xx — treat as unsafe |

```typescript
import {
  isSafeFallbackEligible,
  evaluateFallback,
  classifySubmissionState,
  classifyFromOperationOutcome,
  trySelectFallbackGateway,
  isExpertUnsafeFallbackOverride,
  UnsafeFallbackDeniedError,
} from "@paykernel/routing";

isSafeFallbackEligible("timeout"); // false
isSafeFallbackEligible("not_submitted"); // true
isSafeFallbackEligible("pre_submission_failure"); // true
isSafeFallbackEligible("indeterminate"); // false
isSafeFallbackEligible("connection_reset"); // false
isSafeFallbackEligible("provider_5xx_uncertain"); // false
isSafeFallbackEligible("submitted"); // false

evaluateFallback({ submissionState: "indeterminate" });
// { allowed: false, reason: "denied_indeterminate", submissionState: "indeterminate" }
```

### Structural deny (never automatic)

The following are **always** denied for automatic multi-gateway retry unless a valid **expert override** is supplied:

- `timeout`
- `connection_reset`
- `indeterminate`
- `provider_5xx_uncertain`
- `submitted`

Generic network errors without a safe classification fail closed to **`indeterminate`** (not `pre_submission_failure`).

### AbortError / AbortSignal (multi-gateway — default fail-closed)

Default `classifySubmissionState` maps `AbortError` / `code: "abort_error"` / `ABORT_ERR` / errorKind `"abort"` / `"aborted"` / `"abort_error"` to **`indeterminate`**, which is **not** fallback-eligible (`evaluateFallback` → `allowed: false`).

Abort may race **after** provider accept (client timeout, `AbortSignal` deadline while the provider already committed). Treating abort as `not_submitted` and auto-routing to another gateway risks **double charge** — so the library **never** auto-falls back on raw abort shapes.

**When abort is known pre-submit** (cancelled before the outbound HTTP call):

- Pass `errorKind: "aborted_before_submit"` or `"cancelled_before_submit"` → `not_submitted` (safe)
- Or pass explicit `submissionState: "not_submitted"`
- Or (legacy / expert) `expertUnsafeAbortAsNotSubmitted: true` to restore the old AbortError → `not_submitted` mapping — **only** if you control the abort boundary pre-submit

```typescript
// Default: AbortError is not multi-gateway fallback-eligible
const state = classifySubmissionState({ error: err }); // AbortError → indeterminate
const eligibility = evaluateFallback({ submissionState: state });
// eligibility.allowed === false

// Known pre-submit cancel
const preSubmit = classifySubmissionState({
  errorKind: "aborted_before_submit",
});
// preSubmit === "not_submitted" → evaluateFallback allowed

// Expert legacy mapping (unsafe if abort can be post-accept)
const legacy = classifySubmissionState({
  error: err,
  expertUnsafeAbortAsNotSubmitted: true,
});
// legacy === "not_submitted" — app owns double-charge risk
```

Never widen `SAFE_STATES` to include `timeout` / `connection_reset` / bare network errors / bare abort.

### Classification helpers

#### `classifyFromOperationOutcome(outcome)`

Maps core `PaymentOperationOutcome` conservatively:

| Outcome | `SubmissionState` |
| --- | --- |
| `indeterminate` | `indeterminate` |
| `succeeded` / `requires_action` / `declined` | `submitted` |
| `failed` | `submitted` (generic failed is **not** assumed pre-submit) |

**Never** maps `indeterminate` → `pre_submission_failure`.

#### `classifySubmissionState(input)`

Priority (money-moving / uncertain signals win over pre-submit-only kinds):

1. Explicit `submissionState` **only if** it does not override money-moving /
   uncertain evidence into a SAFE state (P21-EXPLICIT-STATE). Safe explicit
   state + unsafe evidence (outcome `indeterminate` / `succeeded` / `failed` /
   `declined` / `requires_action`, or `timeout` / `connection_reset` /
   `provider_5xx_uncertain` / `submitted` / abort kinds) → use the unsafe
   evidence. Expert override remains the only way to allow unsafe fallback.
   Explicit state still wins when there is no conflicting money evidence.
2. Known **transport / uncertain** `errorKind` strings (`timeout`, `ECONNRESET`, `provider_5xx_uncertain`, abort shapes, …) — **not** deferred
3. Matching **transport / uncertain** error object shape (name/code/message/statusCode)
4. `outcome` / result `outcome` field / core `isIndeterminateOutcome` (e.g. succeeded / declined / indeterminate)
5. Only then: deferred **pre-submission-only** classifications from `errorKind` / error
   (`configuration_error`, explicit `not_submitted` / `aborted_before_submit`,
   or a **ValidationError-shaped object**)
6. Default: **`indeterminate`** (fail-closed for fallback)

**`validation_error` is not pre-submit by itself (P21-VALIDATION-ERROR).** Bare
`errorKind: "validation_error"` (no ValidationError-shaped object) classifies as
**`indeterminate`** — the same class as `invalid_request`. Only
`name === "ValidationError"` or `code === "validation_error"` on a
ValidationError-shaped **object** is `pre_submission_failure`. **Apps must never
map a provider HTTP 400 onto `errorKind: "validation_error"`** — that would
teach unsafe post-accept multi-gateway fallback.

**Why step 5 is last:** a validation-looking signal must not classify as
`pre_submission_failure` (multi-gateway safe) when an operation outcome already
indicates the request was accepted or money state is unknown.

```typescript
classifyFromOperationOutcome("indeterminate"); // → "indeterminate"

classifySubmissionState({ errorKind: "timeout" }); // → "timeout"
classifySubmissionState({ errorKind: "ECONNRESET" }); // → "connection_reset"
classifySubmissionState({ errorKind: "validation_error" }); // → "indeterminate"
classifySubmissionState({
  error: { name: "ValidationError" },
}); // → "pre_submission_failure"
classifySubmissionState({ errorKind: "not_submitted" }); // → "not_submitted"
classifySubmissionState({ errorKind: "aborted_before_submit" }); // → "not_submitted"
classifySubmissionState({ errorKind: "provider_5xx_uncertain" }); // → "provider_5xx_uncertain"
classifySubmissionState({ outcome: "indeterminate" }); // → "indeterminate"
classifySubmissionState({
  submissionState: "not_submitted",
  outcome: "indeterminate",
  errorKind: "timeout",
}); // → "timeout" (explicit SAFE does not override money evidence)
classifySubmissionState({}); // → "indeterminate" (fail-closed)
// AbortError / abort_error → "indeterminate" (NOT fallback-eligible)
// expertUnsafeAbortAsNotSubmitted: true → "not_submitted" (legacy; app owns risk)
```

### Expert override API (opt-in, loud, never defaulted)

Unsafe states may proceed **only** with an explicit branded object:

```typescript
type ExpertUnsafeFallbackOverride = {
  readonly confirmUnsafeFallback: true;
  readonly reason: string; // non-empty after trim
};

evaluateFallback({
  submissionState: "timeout",
  expertOverride: {
    confirmUnsafeFallback: true,
    reason: "provider confirmed no payment intent created",
  },
});
// { allowed: true, reason: "expert_override:…", expertOverride: true, … }
```

Rules:

- Bare `true` / incomplete objects are **not** accepted (type-level + runtime)
- Empty / whitespace reason is **not** accepted
- Override is **never** defaulted by the library
- Runtime guard: `isExpertUnsafeFallbackOverride(value)`

Note: `expertUnsafeAbortAsNotSubmitted` on `classifySubmissionState` only changes **classification** of abort shapes; it does not bypass `evaluateFallback` for other unsafe states. For abort → `not_submitted`, fallback becomes allowed because `not_submitted` is a safe state — use only when pre-submit is guaranteed.

### Alternate gateway helper

```typescript
const state = classifySubmissionState({
  error: { name: "ValidationError", message: "local schema" },
});
const eligibility = evaluateFallback({ submissionState: state });

if (eligibility.allowed) {
  const next = trySelectFallbackGateway(router, input, eligibility, {
    attemptedGateways: ["stripe"],
  });
  // next.gateway ≠ "stripe" when another rule/fallback is available
  await payments.createPayment(params, next.gateway);
} else {
  // do not auto-route
}
```

`trySelectFallbackGateway`:

- Throws `UnsafeFallbackDeniedError` when `!eligibility.allowed`
- Merges `attemptedGateways` into exclusions (plus `input.excludeGateways`)
- Reuses pure `router.select` with exclusions — still **select-only**
- Throws if the only available gateway was already attempted
- **NEW-ROUTE-1 / NEW-ROUTE-2 / NEW-ROUTE-CCY-1:** amount-range / capability / currency-mismatch / complementary currency-country-method-tenant honesty `NoRouteMatchError` is **not** rewritten to `no_alternate_gateway`. The honesty `reason` (and message) is preserved on `UnsafeFallbackDeniedError`.
- **ROUTE-3:** expert-override eligibility must come from `evaluateFallback` (object identity brand). Forged `{ allowed: true, expertOverride: true, reason: "expert_override:…" }` objects are rejected — the reason prefix alone is not sufficient.

## App responsibility

```text
App flow
  ├── decision = router.select(input)          // pure
  ├── result = createPayment(..., decision.gateway)
  ├── on failure: state = classifySubmissionState(...)
  ├── eligibility = evaluateFallback({ submissionState, expertOverride? })
  └── if eligibility.allowed:
        alt = trySelectFallbackGateway(...)
        createPayment(..., alt.gateway)
      else:
        stop / reconcile / human ops — NEVER silent multi-gateway retry
```

Reconciliation’s `do_not_create_replacement` / `shouldForbidReplacementCharge` is a **related** safety idea (decision-only, no `createPayment`) but is **not** a substitute for this eligibility API. See `@paykernel/reconciliation`.

## Non-goal (roadmap §2.2)

**Never** automatically retry or route an **indeterminate** payment to another gateway.

Timeouts, connection resets, uncertain provider 5xx, and raw **AbortError** / abort codes are treated the same way for automatic multi-gateway fallback: **denied**. Only definitive pre-submission failures and true not-submitted states (including explicit `aborted_before_submit`) are safe without an expert override.

## Related

- [selection.md](./selection.md) — select-time fallback vs this surface
- [telemetry.md](./telemetry.md) — keep attempted `gateway` visible in ops
- Core outcomes: [`packages/core/docs/operation-results.md`](../../core/docs/operation-results.md)
