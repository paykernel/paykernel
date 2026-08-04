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

### AbortError / AbortSignal caution (multi-gateway)

Default `classifySubmissionState` maps `AbortError` / `code: "abort_error"` to **`not_submitted`**, which is **default-allow** for post-attempt fallback (`evaluateFallback` → `allowed: true`).

That is only safe when the abort is known to fire **before** the provider accepted the request (e.g. cancelled before the outbound HTTP call). If the abort can race **after** accept (client timeout, `AbortSignal` deadline while the provider already committed), treating it as `not_submitted` and auto-routing to another gateway risks **double charge**.

**Recommendations for multi-gateway integrators:**

- Prefer classifying aborts as **`indeterminate`** (or recon / manual_review) unless you control the abort boundary pre-submit.
- Pass explicit `submissionState` / `errorKind` rather than relying on raw `AbortError` shape when the request may have left your process.
- Or supply a custom classification wrapper around `classifySubmissionState` that maps abort → `indeterminate` for multi-gateway paths.
- Never widen `SAFE_STATES` to include `timeout` / `connection_reset` / bare network errors.

```typescript
// Conservative multi-gateway pattern
const raw = classifySubmissionState({ error: err });
const state =
  err instanceof Error && err.name === "AbortError"
    ? "indeterminate"
    : raw;
const eligibility = evaluateFallback({ submissionState: state });
```


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

Priority:

1. Explicit `submissionState` if provided
2. Known `errorKind` strings (`timeout`, `ECONNRESET`, `validation_error`, `not_submitted`, …)
3. Error object shape (name/code/message/statusCode patterns — no secrets required)
4. `outcome` / result `outcome` field / core `isIndeterminateOutcome`
5. Default: **`indeterminate`** (fail-closed for fallback)

```typescript
classifyFromOperationOutcome("indeterminate"); // → "indeterminate"

classifySubmissionState({ errorKind: "timeout" }); // → "timeout"
classifySubmissionState({ errorKind: "ECONNRESET" }); // → "connection_reset"
classifySubmissionState({ errorKind: "validation_error" }); // → "pre_submission_failure"
classifySubmissionState({ errorKind: "not_submitted" }); // → "not_submitted"
classifySubmissionState({ errorKind: "provider_5xx_uncertain" }); // → "provider_5xx_uncertain"
classifySubmissionState({ outcome: "indeterminate" }); // → "indeterminate"
classifySubmissionState({}); // → "indeterminate" (fail-closed)
// AbortError shape → "not_submitted" (default-allow). Unsafe if abort can be post-accept;
// see AbortError caution above for multi-gateway.
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

### Alternate gateway helper

```typescript
const state = classifySubmissionState({ errorKind: "validation_error" });
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

Timeouts, connection resets, and uncertain provider 5xx are treated the same way for automatic multi-gateway fallback: **denied**. Only definitive pre-submission failures and true not-submitted states are safe without an expert override.

## Related

- [selection.md](./selection.md) — select-time fallback vs this surface
- [telemetry.md](./telemetry.md) — keep attempted `gateway` visible in ops
- Core outcomes: [`packages/core/docs/operation-results.md`](../../core/docs/operation-results.md)
