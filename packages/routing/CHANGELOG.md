# @paykernel/routing

## Unreleased

### Patch

- **NEW-ROUTE-1:** Complementary **currency / country / paymentMethod** partitions honesty-block unconstrained select-time fallback after the matching bucket is excluded or unhealthy (same fail-closed as amount-range). `USD→stripe` + `EUR→adyen` + `fallback: stripe` with `excludeGateways: ["adyen"]` and EUR input throws `NoRouteMatchError` (`complementary_currency_honesty`) instead of silently selecting stripe. Unmatched values (GBP) may still use fallback. `trySelectFallbackGateway` preserves amount / capability / complementary-partition honesty reasons and does **not** rewrite them to `no_alternate_gateway`.
- **Money-safe (N3):** `classifySubmissionState` now maps raw `AbortError` / `abort_error` / `ABORT_ERR` (and errorKind `abort` / `aborted` / `abort_error`) to **`indeterminate`**, not `not_submitted`. Default post-attempt multi-gateway fallback is therefore **denied** when only an abort shape is known — abort may race after provider accept (double-charge risk). Explicit pre-submit signals (`errorKind: "aborted_before_submit"` / `"cancelled_before_submit"`, or `submissionState: "not_submitted"`) remain safe/eligible. Legacy mapping restored only via `expertUnsafeAbortAsNotSubmitted: true`. Docs/tests updated.
