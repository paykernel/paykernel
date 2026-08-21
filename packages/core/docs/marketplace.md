# Marketplace capability group

Phase 22.4. **Not a separate package.** Marketplace operations are a capability group on core.

## In this release

- **Create-time splits** — capability `marketplaceSplits`. Moyasar `splits` on `createPayment` is the proving adapter (including negative reverse splits via money `allowNegative`).
- Passing `splits` on create requires the adapter to claim `marketplaceSplits`. Unclaimed adapters throw `OperationNotSupportedError`.
- Moyasar create uses **`MoyasarPaymentSplit.recipient_id`**. Generic `MarketplaceSplit.destination` is vocabulary only and is **not** mapped onto Moyasar payloads.

## Out of this release

- Stripe Connect onboarding, destination charges, transfers, payouts
- PayPal Commerce Platform
- Connected-account KYC / merchant-of-record

`MarketplaceSplit`, `Transfer`, and `Payout` types exist as vocabulary (`TransferStatus` / `PayoutStatus` already live in domain status). Adapters must implement and claim a surface before those methods appear. Empty Connect APIs are intentionally omitted. `MarketplaceSplit.destination` is not a Moyasar wire field.
