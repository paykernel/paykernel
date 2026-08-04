# @paykernel/routing

## Unreleased

### Patch

- **Money-safe (N3):** `classifySubmissionState` now maps raw `AbortError` / `abort_error` / `ABORT_ERR` (and errorKind `abort` / `aborted` / `abort_error`) to **`indeterminate`**, not `not_submitted`. Default post-attempt multi-gateway fallback is therefore **denied** when only an abort shape is known — abort may race after provider accept (double-charge risk). Explicit pre-submit signals (`errorKind: "aborted_before_submit"` / `"cancelled_before_submit"`, or `submissionState: "not_submitted"`) remain safe/eligible. Legacy mapping restored only via `expertUnsafeAbortAsNotSubmitted: true`. Docs/tests updated.
