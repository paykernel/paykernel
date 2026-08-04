# @paykernel/sql-foundation

## 0.1.0-next.0


### Patch

- Webhook fail templates: optional `restoreAttemptFlag` decrements attempts (parking claim parity).
- Webhook claim: `decideWebhookClaim` / SQL templates gate `pending` on `available_at <= now` (`not_available`); expired lease reclaim still allowed for recovery.
- Document injectable clock vs multi-host NTP for ISO TEXT lease comparisons.

### Major Changes

- Initial public packaging of the shared relational foundation previously only
  available as private `@paykernel/internal-sql-store` (ship-blocker B8 option B:
  publishable `sql-foundation`; adapters depend on this package at runtime).
