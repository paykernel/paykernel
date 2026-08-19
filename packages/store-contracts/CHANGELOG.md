# @paykernel/store-contracts

## Unreleased

### Patch Changes

- **S19-WH-HASH-TOCTOU:** additive `ClaimWebhookInput.ifMatchPayloadHash`. When set, idle hash mismatch is `payload_hash_conflict` with no rewrite so retry workers cannot roll a newer body backwards. Omit on first delivery so WEBHOOKS-3 idle supersede still runs.
- **N4 / markIndeterminate fencing wording:** document intentional A4 near-expiry parking (`status=reserved` + matching token may park even if lease clock passed; post-reclaim token is fenced). Clarify `deleteExpired` is terminal-only (not reclaimable reserved).
- Webhook inbox: additive claim kind `not_available` (pending + future `availableAt`); additive `FailWebhookInput.restoreAttempt` for parking-claim attempt restore; `availableAt` is a key-addressed claim gate.

## 0.1.0-next.0

### Major Changes

- Initial PayKernel prerelease: lease-aware store contracts, StoreError taxonomy,
  and storage adapter manifests extracted from `@paykernel/testkit` for production
  install graphs (ship-blocker fix B9).
