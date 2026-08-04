# PayKernel monorepo deep audit report

| Field | Value |
| --- | --- |
| **Date (UTC)** | 2026-08-04 |
| **Verdict** | **FAIL** |
| **Live checks** | PASS (typecheck, tests, boundaries, portability, lint) |
| **Confirmed blocking** | 7 correctness defects + 2 packaging ship blockers |
| **Auditor** | Fail-closed package deep audit (multi-domain verified findings) |
| **Scope** | Full monorepo at `/home/shahin/Documents/projects/personal/packages/paykernel` |
| **Constraints** | Report only — no source edits, no commit, no push |

## Auditor notes

This audit is **fail-closed**: any confirmed money-status, durable-retry, lease-fencing, recovery-drain, or packaging ship-blocker finding forces **FAIL**, even when the live CI surface is fully green.

**pass rule applied:** `pass = true` only if `confirmed_blocking` is empty **and** `live_ok` is true. Here `live_ok = true` but `confirmed_blocking` is non-empty → **FAIL**.

Green tests do **not** override logic defects that are either untested (ackAfterClaim vs maxAttempts, claim vs availableAt, SQL abandoned-claim drain) or encoded as intentional per-gateway docs that diverge from product status semantics (Moyasar refund base).

Cross-package packaging blockers (private `@paykernel/internal-sql-store` + full `@paykernel/testkit` runtime deps on publishable adapters) are treated as **ship blockers** for external npm consumers, independent of unit-test greenness inside the workspace.

---

## Live checks summary

| Check | Result |
| --- | --- |
| `bun run typecheck` | exit 0 |
| `bun test` | exit 0 — **1904 pass, 0 fail, 26 skip, 148 files** |
| `bun run check:boundaries` | exit 0 |
| `bun run check:runtime-portability` | exit 0 |
| `bun run lint` | exit 0 |
| **Overall live** | **PASS** |

**Live greps (non-exhaustive, confirmatory):**

- No banned `node:` / `bun:` / `cloudflare:` imports in portable production `src`.
- Float/money hits are comments, jitter, or provider parse helpers — not `amount * 100` conversion paths.
- Lease/claim fencing and secret redaction patterns present as designed.
- Stripe `as any` / webhook object typing escapes present as expected design.

**Live does not prove:** refund completeness semantics under partial capture (Moyasar), maxAttempts arithmetic with `ackAfterClaim`, claim backoff under provider redelivery, SQL abandoned-claim discovery, Redis fail lease expiry parity, multi-host clock fencing, or publishable adapter install graphs outside the workspace.

---

## Domain audit summaries

### core-gateways

Largely fail-closed: bigint money conversion, `isPaidOutcome` excludes `authorized`, after-hooks cannot flip top-level paid/outcome scalars, webhook verified compose is fail-fast, all four gateways dual-write Phase 6 outcomes + Phase 7 `PaymentEvent`. Historical items (PayPal raw verify + replay, Stripe captured-base refunds, Paymob `is_auth` after capture, Moyasar verified/3ds/`secret_token`) match intentional design.

**Blocking residual:** Moyasar `resolvePaymentStatus` uses original authorization `amount` as refund completeness base (never `captured`), so full refund of a partial capture maps to `partially_refunded` instead of `refunded`. Stripe, Paymob, mock gateway, and `behavioral-contracts.md` use a captured base.

**Non-blocking residuals:** shallow after-hook freeze (nested `references` / `nextAction` share identity); PayPal map/parse honesty drift for `PAYMENT.REFUND.COMPLETED`; documented `approved` paid-like footgun (intentional Phase 6).

### webhooks-inbox

Fencing, concurrent claim singleton, silent-ACK prohibition, mode isolation, and crash-boundary outcomes are real and well-tested. Secrets are not persisted by default; envelope is a caller trust boundary. No banned runtime builtins.

**Blocking residuals:**

1. `maxAttempts` counts the `ackAfterClaim` parking claim → premature `dead_letter` (off-by-one vs “handler attempts”).
2. `claim` ignores `availableAt` across memory/SQL/Redis → provider redelivery burns attempt budget despite `retryAfterMs`.

**Non-blocking residuals:** `NonRetryableHandlerError({deadLetter:false})` poison spin; vestigial `failed` status; docs calling `availableAt` a universal next-attempt claim gate.

### stores-adapters

Generally well-engineered: engine-level atomic claims, dual fencing (generation + leaseToken), explicit migrations, honest manifests (SQLite single-host, Redis optional durability, D1 session RAW, no multi-region). No SQL-injection claim path; production lease tokens are crypto-random.

**Blocking residuals:**

1. SQL `listRetryable` only selects `status='pending'` — abandoned `claimed`+expired rows invisible to `processRetryable` (memory/Redis soft-release recover; SQL does not).
2. Redis `WEBHOOK_FAIL_LUA` does not require unexpired lease while complete/SQL fail do — lease-fencing parity break.
3. Lease reclaim/complete fencing uses client/wall clocks (ISO TEXT / ms ARGV), not DB-authoritative time — multi-host skew risk.

**Non-blocking (downgraded from BLOCK):** DO `createDoPaymentStores` list/cleanup via sentinel shards only (partition-local by design; incomplete multi-partition discovery/retention). Incomplete `tenantColumnEnabled` scaffolding. Packaging ship blockers (private internal + full testkit).

### recon-routing-obs

Largely fail-closed: recon is decision-only with safe ordered lookup and atomic claim scheduling; routing select is pure with bigint amount ranges; observability has no hard OTEL dep and redacts telemetry bags. No silent invent-paid/failed from transport.

**Residuals (not in confirmed_blocking):** recon `moneyEquals` string equality (`"10"` vs `"10.00"` false drift → `manual_review`); `classifySubmissionState` maps `AbortError` → `not_submitted` (integrator footgun if abort may have reached provider — product/docs hardening, not confirmed money-loss in SDK alone).

### Cross-cutting

Live-green monorepo: false-paid/indeterminate/lease fencing/select-only routing/Redis-optional/dual-CF packaging/`PaymentEvent` dual-write/portable domain sources are implemented and conformance-backed. No silent SDK path converts uncertain outcomes to paid.

**Primary ship blockers:** publishable `@paykernel/store-*` hard-depend on private `@paykernel/internal-sql-store` and full `@paykernel/testkit` (production install graph pollution).

---

## Blocking findings

### 1. Moyasar refund completeness uses authorization `amount`, not `captured`

| | |
| --- | --- |
| **Domain** | core-gateways |
| **Class** | LOGIC / money-status |
| **Severity** | **BLOCKING** |

**Defect.** `MoyasarGateway.resolvePaymentStatus` classifies refund completeness against original auth amount only. It never compares `refunded` to `captured`. Full refund of a partial capture is therefore mis-mapped to `partially_refunded`.

**Evidence** — `packages/core/src/gateways/moyasar/moyasar.gateway.ts` (~1486–1490):

```ts
if (refunded > 0 && refunded < amount) {
  return "partially_refunded";
}
if (refunded >= amount && amount > 0) {
  return "refunded";
}
// `captured` is only used later for partially_captured
```

**Concrete mis-map:** `amount=10000`, `captured=3000`, `refunded=3000` → `partially_refunded` (should be `refunded`).

**Contrast (correct baselines):**

- Stripe: `capturedBase = amount_received → amount_captured → amount`; `amount_refunded >= capturedBase` → `refunded` (`stripe.gateway.ts` ~1217–1236).
- Paymob: `refundBaseline = captured_amount > 0 ? captured_amount : amount_cents` with explicit comment that full refund of partial capture is `refunded` (`paymob.gateway.ts` ~1534–1553).
- Mock gateway: `refundedAmountMinor >= capturedAmountMinor`.
- Product contract (`packages/core/docs/behavioral-contracts.md`): `refunded` = full refund of **captured** amount; `partially_refunded` implies remaining captured balance may exist.

**Impact.** Apps branching on `status === "refunded"` vs `"partially_refunded"` under-report full refunds of partial captures on Moyasar only — cross-gateway status divergence and inventory/fulfillment reverse-policy footgun. Partial capture is a supported Moyasar path (tests/docs). Amount-derived path overrides provider status string.

**Not dismissed as:** docs-only, false positive, or intentional product semantics — product docs require captured base; Moyasar code/docs encode the wrong base.

---

### 2. Moyasar docs encode the same wrong refund baseline (cross-gateway INCONSIST)

| | |
| --- | --- |
| **Domain** | core-gateways |
| **Class** | INCONSIST (docs + code agree with each other; disagree with product + other gateways) |
| **Severity** | **BLOCKING** (same root defect as #1; docs reinforce the bug) |

**Evidence.** `packages/core/docs/moyasar.md` Partial statuses: `refunded > 0 && refunded < amount` → `partially_refunded`; full refund amount → `refunded`. No captured baseline.

Paymob/Stripe docs correctly document captured base for full-refund-of-partial-capture.

**Impact.** Fixing code alone without docs/tests would leave operator guidance wrong; fixing docs alone would paper over money-status divergence. Both must move to captured base.

---

### 3. `ackAfterClaim` burns a claim attempt → premature `dead_letter` vs `maxAttempts`

| | |
| --- | --- |
| **Domain** | webhooks-inbox |
| **Class** | LOGIC / durable recovery |
| **Severity** | **BLOCKING** |

**Defect.** `shouldDeadLetter` compares store claim `attempts` to `maxAttempts`, but `maxAttempts` is documented as **max handler attempts**. The `ackAfterClaim` parking path claims then `store.fail(retryAfterMs:0)` **without** running the handler — that claim still increments `attempts`.

**Evidence:**

- Claim increments attempts: `packages/webhooks/src/memory-store.ts` ~193 (`attempts: (base?.attempts ?? 0) + 1`).
- Parking path: `packages/webhooks/src/engine.ts` ~435–452 (`ackAfterClaim` → `store.fail` → `scheduled_for_retry`, no handler).
- Dead-letter rule: `engine.ts` ~176 / ~290–294 — `attempts >= maxAttempts` in `durable_retry`.
- Docs: `packages/webhooks/src/types.ts` ~198 — “Max **handler** attempts before dead-letter”.

**Trace (`maxAttempts=3`):**

| Path | Handler runs before DL |
| --- | --- |
| Without `ackAfterClaim` | 3 |
| With `ackAfterClaim` | **2** (parking claim burns attempt 1; handlers on attempts 2 and 3) |

**Impact.** Premature terminal `dead_letter` on the durable ack+worker path reduces recovery budget under transient handler failures; can drop durable retries and lose fulfillment. Terminal dead_letter is permanent (`duplicate_failed` on re-claim).

---

### 4. `claim` ignores `availableAt` / `retryAfterMs` (redelivery burns attempts)

| | |
| --- | --- |
| **Domain** | webhooks-inbox (+ all store adapters) |
| **Class** | LOGIC / backoff contract break |
| **Severity** | **BLOCKING** |

**Defect.** `fail(retryAfterMs)` / `defaultRetryAfterMs` only delay **list** discovery (`listRetryable` / `processRetryable`). Key-addressed `claim` reacquires any `pending` (or expired-lease) row with **no** `availableAt` gate. `processVerified` always `store.claim()`s, so provider redelivery after fail re-runs the handler and increments attempts despite a future `availableAt`.

**Evidence (all claim implementations):**

- Memory claim: no `availableAt` check; acquire when pending/expired (`memory-store.ts` claim path).
- SQL templates (`internal/sql-store` `webhookClaimTemplates`): `WHERE status='pending' OR lease_expires_at <= now` — no `available_at`.
- Redis `WEBHOOK_CLAIM_LUA`: pending/expired reclaim, no `available_ms` gate.
- Algorithm `decideWebhookClaim`: pending or expired lease → reclaim; ignores `existing.availableAt`.
- `listRetryable` correctly filters `available_at <= now` (e.g. postgres webhook store ~195–196).
- Contract wording: `FailWebhookInput` / store docs describe delay before **next claim**; `availableAt` mapped as “next attempt” (`packages/webhooks/src/store.ts` ~37).

**Impact.** Contradicts documented backoff; under 5xx redelivery storms, attempts burn faster than intended and compound with #3 toward premature `dead_letter`.

---

### 5. SQL `listRetryable` cannot drain abandoned expired claims

| | |
| --- | --- |
| **Domain** | stores-adapters |
| **Class** | LOGIC / durability recovery gap |
| **Severity** | **BLOCKING** |

**Defect.** After a worker crash leaves `status=claimed`, lease expiry alone does **not** make the row visible to `listRetryable` on postgres/sqlite/turso/d1/DO SQL stores. Those adapters select only `status='pending'`. Memory soft-releases on list/get; Redis soft-releases on get and re-indexes. `processRetryable` only lists then claims those keys — never scans claimed+expired.

**Evidence:**

- Postgres `listRetryable`: `WHERE status = 'pending' AND available_at <= $1` (`store-postgres` webhook-inbox-store ~195–196). Same pattern on sqlite/turso/d1/do SQL stores.
- Memory: `releaseExpiredLease` before list filter (`memory-store.ts` ~87–108, ~274–285).
- Redis: `WEBHOOK_GET_LUA` soft-releases expired claims to pending + ZADD retry index; claim ZREMs index so abandoned rows stay out until soft-release.
- SQL **key-addressed** claim templates **do** allow reclaim when `lease_expires_at <= now` — redelivery/claim(key) works; pure poll workers do not.

**Impact.** Under `durable_retry` after provider ACK, abandoned SQL claims stay stuck forever unless something re-invokes claim with the known key (provider redelivery). Real unprocessed payment-webhook recovery gap — not docs-only. Docs claiming `processRetryable` reclaims after expiry are wrong for SQL stores.

---

### 6. Redis `WEBHOOK_FAIL_LUA` accepts expired leases (adapter parity / fencing skew)

| | |
| --- | --- |
| **Domain** | stores-adapters |
| **Class** | LOGIC / lease fencing |
| **Severity** | **BLOCKING** |

**Defect.** Redis fail only checks `status==claimed` and `lease_token` match — **no** `lease_expires_ms > nowMs`. Redis complete and SQL fail both require an active (unexpired) lease. Contract/`decideLeaseMutation` document fail must reject expired leases (`lease_lost`).

**Evidence** — `packages/store-redis/src/scripts/webhook-inbox.lua.ts`:

- `WEBHOOK_COMPLETE_LUA` ~223–226: `exp <= nowMs` → `lease_lost`.
- `WEBHOOK_FAIL_LUA` ~273–276: claimed + token only; then HSET pending/dead_letter with **no** expiry check.

SQL `webhookFailTemplates` WHERE includes `lease_expires_at > now`.

**Impact.** Redis can transition to pending/dead_letter after exclusive ownership expired while SQL cannot — dual-worker windows and adapter-dependent outcome semantics near lease boundaries.

---

### 7. Lease fencing uses client-injected / wall clocks (multi-host skew)

| | |
| --- | --- |
| **Domain** | stores-adapters |
| **Class** | SEC / fencing |
| **Severity** | **BLOCKING** |

**Defect.** Lease reclaim and complete fencing compare client-supplied `now` (ISO TEXT in SQL, ms ARGV in Redis) — not DB/server-authoritative `NOW()` / `TIME`. Multi-host clock skew can early-reclaim still-live leases or fail completes near expiry, opening dual-worker windows despite token checks after reclaim.

**Evidence:**

- SQL templates bind client ISO `now` as TEXT compare on reclaim/complete.
- Postgres adapters set those from `clockNowIso(ctx.clock)` / `clockAddMsIso` with default `Date.now()`.
- Redis Lua compares `lease_expires_ms` to client ARGV `nowMs`; docs note not relying on Redis `TIME`.
- Algorithm `isLeaseActive` / `decideLeaseMutation` take client `nowMs`.
- Injectable `FakeClock` is intentional for tests; production multi-host safety still depends on unsynchronized client clocks with no engine-time fence.

**Impact.** Residual claim race / double-processing risk under skew — not fixed, not merely docs drift.

---

### 8. Publishable store adapters hard-depend on private `@paykernel/internal-sql-store`

| | |
| --- | --- |
| **Domain** | cross / packaging |
| **Class** | BLOCK (ship) |
| **Severity** | **BLOCKING** for external npm release |

**Defect.** `@paykernel/store-postgres`, `store-sqlite`, `store-turso`, `store-d1`, `store-durable-objects` list `"@paykernel/internal-sql-store": "workspace:*"` as a **runtime dependency**. Package is `"private": true` under `internal/sql-store` (`privateInternal` / never-publish-internal policy). External npm consumers cannot resolve it unless internal is published or bundled.

**Impact.** Contradicts publishable-adapter docs. Workspace installs work; real-world installs of published adapters break.

---

### 9. Production adapters hard-depend on full `@paykernel/testkit`

| | |
| --- | --- |
| **Domain** | cross / packaging |
| **Class** | BLOCK (ship) |
| **Severity** | **BLOCKING** for production install graph |

**Defect.** All production store adapters depend on full `@paykernel/testkit` at runtime for `StoreLeaseLostError` / contracts. That pulls core + webhooks + reconciliation and **non-production memory factories** into production install graphs.

**Impact.** Oversized, wrong-layer production deps; testkit changes break all adapters; should be a slim contracts package or type-only peer before real release.

---

## Non-blocking findings

### core-gateways

1. **Shallow after-hook freeze** — `BaseGateway.shallowCloneResult` is `{...result}` only; `restoreMoneyIdentityFields` restores top-level `MONEY_IDENTITY_KEYS` only. Nested `references` / `nextAction` share identity with `originalResult`; in-place nested mutation poisons the snapshot. Real hole vs “freeze” language; non-blocking because top-level paid/outcome/amount/id primitives are protected and exploitation requires app-owned after-hook code in the same trust domain.

2. **After-hook nested nextAction/references rewrite** — same mechanism as (1); redirect URL / identity string nested writes not restored. Docs/comments overstate freeze completeness for nested objects.

3. **PayPal `PAYMENT.REFUND.COMPLETED` map vs parse** — `PAYPAL_EVENT_TYPE_MAP` maps it to `refund.completed`, but live `parseWebhookEvent` rejects (intentional Payments v2 path is `PAYMENT.CAPTURE.REFUNDED`). Map/parse honesty drift / dead map entry for gateway parse; dual-write map still usable for hand-built types.

### webhooks-inbox

4. **`shouldDeadLetter` claim-count vs “handler attempts” docs** — same root as blocking #3; separately noted as docs/semantics drift when severity is “earlier DL only”. Full durable path remains **blocking** under premature terminalization.

5. **`NonRetryableHandlerError({deadLetter:false})` poison loop** — early-returns non-dead-letter; store stays pending; outcome advertises `handler_failed{retryable:false}`; `processRetryable` can spin indefinitely. Opt-in footgun; default still dead-letters.

6. **Status enum `failed` is dead write path** — typed/CHECK-allowed, but all production fail paths write only `pending` or `dead_letter`. Claim `duplicate_failed` branches are defensive for legacy/manual rows.

7. **`maxAttempts` JSDoc vs claim counter** — docs drift companion to #3/#4.

8. **`availableAt` “next attempt” wording vs claim ignore** — docs overstate field as universal claim gate; list-vs-claim split is real; full redelivery burn path is **blocking #4**.

9. **Status `failed` vs fail() only pending|dead_letter** — enum surface clutter; adapters mutually consistent on write path.

### stores-adapters

10. **DO `createDoPaymentStores` list/cleanup sentinels** — `listDue` / `listRetryable` / `deleteExpired` route only via `__list__` / `__cleanup__`. Under `kind:"key"` never see real rows; under `kind:"hash"` only one of N partitions. Incomplete discovery/retention for multi-partition Worker client; key-addressed claim/get/complete remain correct. Documented partition-local limit (phase-17 non-blocking); **not** money-loss A1–A3. Prior BLOCK severity was wrong.

11. **Postgres post-claim SELECT classification** — 0-row RETURNING → separate read-only SELECT for why; classification can lag concurrent state but never false `acquired`. Intentional design.

12. **`tenantColumnEnabled` does not enforce isolation** — stores never write/filter `tenant_id`; PK is key-only. Dead multi-tenant scaffolding / docs drift, not wired contract.

### Cross / packaging / docs / residual

13. **Triplicated webhook claim SQL** in d1/turso/do vs sql-store templates — maintenance drift risk.

14. **Dual in-memory webhook stores** (webhooks package-local vs testkit) — fencing can diverge.

15. **Core 0.x IdempotencyStore vs testkit lease-aware dual contracts** — documented, still confusing.

16. **Recon `moneyEquals` string equality** — `"10"` vs `"10.00"` false drift → `manual_review` (not false-paid).

17. **Doc path drift** — `docs/workspace-boundaries.md` / `docs/monorepo.md` still list `packages/adapter-*`; real dirs are `packages/store-*`.

18. **Core `docs/webhooks.md` Express sample** — “fulfill from `event.status` / `event.gatewayPaymentId`” undercuts Phase 6/7 `isPaidOutcome` / stable `PaymentEvent` guidance (integrator false-paid footgun if followed blindly).

19. **Routing `AbortError` → `not_submitted`** — `packages/routing/src/fallback.ts` ~302–303. If apps follow classify→evaluate→trySelect→createPayment after an abort that may have reached a provider, double-submit is possible. Default-deny otherwise holds; product should treat abort as uncertain unless proven pre-submit.

20. **PayPal randomUUID when idempotencyKey omitted** — retry without stable key can double-submit.

21. **Moyasar/Paymob capture/refund/void unguarded without idempotencyStore+key** — loud warnings + docs; multi-worker risk is documented operator responsibility.

22. **Webhook envelope free-form** — apps can persist secrets if they ignore sanitize helpers; engine does not deep-redact app-supplied envelope by default (trust boundary).

23. **`onWebhookReceived` on unverified payload** — documented side-effect-free requirement; misuse could act on forged traffic.

24. **Public-api tests** freeze root symbols but not full package.json multi-subpath export maps for postgres/redis/sqlite.

25. **sql-store multi-step sqlite claim templates** unused by turso/d1/do (inline UPSERT RETURNING copies).

26. **Payment / PaymentEvent amount fields still 0.x major-unit number** — Money preferred on inputs.

27. **Stripe gateway `as any` on webhook shapes** — expected typing escape.

28. **Routing expert override** can allow unsafe multi-gateway fallback only with branded `{confirmUnsafeFallback:true, reason}` — intentional, not default.

---

## Dismissed / false positives (brief)

| Finding | Why dismissed |
| --- | --- |
| `isPaidOutcome` treats PayPal `approved` as paid-like | Intentional Phase 6: `PAID_LIKE` includes `approved`; docs warn capture-required products must not ship on approval alone |
| Stripe webhook future-`t` no abs cap | Intentional documented one-sided skew policy; forging still requires `webhookSecret` |
| Moyasar `secret_token` in-place compare / pre-verify hook visibility | Protocol + deliberate stage order with SECURITY warnings; trusted event is redacted |
| `PAYPAL_EVENT_TYPE_MAP` `PAYMENT.REFUND.COMPLETED` as pure dead code | Map still backs dual-write / external type strings; parse reject is intentional |
| `HooksManager.composeHandlers` final `return next` unreachable | Residual for generic key typing; intentional |
| Docs claim after-hook freeze complete vs shallow impl | Misread: docs specify shallow + top-level restore (nested incompleteness is separate real non-blocking finding) |
| Stripe future-`t` vs stripe-node abs(300) | Documented design choice |
| complete lease_lost after handler success → `handler_failed` not `scheduled_for_retry` | Intentional crash-boundary; correct 5xx redelivery signal |
| No default secret retention in claim path | Optional envelope; caller trust boundary |
| Custom `sanitizeError` can undo sanitization | Explicit opt-in override |
| Memory store `Math.random` lease tokens | NON_PRODUCTION test-only; not exported |
| Non-export of `createMemoryWebhookInboxStore` as dead | Intentional package-local test infra |
| `StoreLeaseLostError.retryable=false` vs engine `handler_failed.retryable=true` | Dual-layer semantics; aligning would be wrong |
| durable_retry complete-after-success lease_lost asymmetry | Outcome labels track store mutation success correctly |
| DO list incomplete multi-partition as silent claim-race | Partition-local design; not A1–A3 money bug (kept as non-blocking #10) |
| SQL identifier injection | Validated `IDENTIFIER_PATTERN` + bound params on production paths |
| Lease tokens as secrets | Opaque unguessable fencing tokens by design (crypto-random in prod) |

---

## Recommended fix priority

### P0 — ship / money-status / durable recovery (block release)

1. **Moyasar refund base → captured** (findings #1–#2)  
   - Compare `refunded` to `captured` when `captured > 0`, else `amount`.  
   - Align `moyasar.md` + unit/webhook tests for full refund of partial capture → `refunded`.  
   - Match Paymob/Stripe/behavioral-contracts.

2. **Webhook attempt accounting** (finding #3)  
   - Either: do not count `ackAfterClaim` parking claim toward `maxAttempts`, **or** document and implement `maxAttempts` as claim budget and raise defaults so handler budget matches docs.  
   - Prefer: separate `handlerAttempts` from claim count, or skip attempt increment on pure park.  
   - Add regression test: `maxAttempts=3` + `ackAfterClaim` → 3 handler failures before DL.

3. **SQL abandoned-claim recovery** (finding #5)  
   - Soft-release expired claims to `pending` on `listRetryable`/`get`, **or** extend list query to include `claimed AND lease_expires_at <= now`.  
   - Align all SQL adapters (postgres/sqlite/turso/d1/do) + docs (`crash-boundaries.md`).

4. **Claim vs `availableAt`** (finding #4)  
   - Product decision required:  
     - **A)** Gate key-addressed claim on `availableAt` (new result kind `not_available`) — true backoff under redelivery; or  
     - **B)** Keep redelivery claimable but **do not increment attempts** / do not count toward DL when reclaimed before `availableAt`; or  
     - **C)** Document that `availableAt` is **list-only** and raise maxAttempts / HTTP ACK guidance.  
   - Fail-closed recommendation: **A or B** — docs currently promise delay before next claim.

5. **Redis fail lease expiry check** (finding #6)  
   - Mirror complete: reject fail when `lease_expires_ms <= nowMs` as `lease_lost`.  
   - Conformance test across Redis vs SQL.

6. **Packaging** (findings #8–#9)  
   - Bundle or publish a slim public contracts package; stop runtime dep on private `internal-sql-store` from published tarballs (bundle into adapter dist or publish versioned internal with clear non-semver policy).  
   - Extract `StoreLeaseLostError` + store contracts out of testkit; adapters depend on slim package only.

### P1 — fencing hardening / consistency

7. **Clock fencing** (finding #7) — prefer DB `NOW()` / Redis TIME (or hybrid) for lease predicates; keep injectable clock only for tests. Document multi-host NTP requirement until fixed.

8. **After-hook deep freeze** (non-blocking 1–2) — deep-clone or structured freeze of `references` / `nextAction` if freeze claims remain.

9. **Dead `failed` status** — remove from enum/schema or implement a real write path; delete defensive-only branches if removed.

### P2 — docs / footguns / hygiene

10. Fix adapter path names in monorepo/workspace docs (`store-*` not `adapter-*`).  
11. Fix core `webhooks.md` fulfill sample → `isPaidOutcome` / `PaymentEvent.type`.  
12. Recon minor-unit/canonical money compare.  
13. Routing AbortError classification docs (uncertain unless proven pre-submit).  
14. PayPal map honesty or parse support for `PAYMENT.REFUND.COMPLETED`.  
15. Deduplicate claim SQL across d1/turso/do.  
16. Align dual memory webhook stores or single-source conformance.

### Regression risks when fixing

- Changing claim fencing in only one of D1/turso/DO/sql-store template paths desyncs reclaim.  
- Hard adapter→testkit coupling: testkit churn breaks all adapters.  
- Integrators following bare `status === 'paid'` examples may reintroduce false-paid.  
- Publishing adapters without resolving private internal breaks consumer installs.  
- Moyasar refund-base fix may change live status strings for existing partial-capture refunds (changelog/migrate guidance).

---

## Honest gaps (documented limits)

These are **accepted 0.x / design limits**, not silent defects:

| Gap | Honesty note |
| --- | --- |
| DO partition-local list/cleanup | Sentinel routing; operators iterate partitions; `supportsRetentionCleanup` honesty + phase-17 report |
| Redis durability | Optional / config-dependent; not a universal durability guarantee |
| SQLite | Single-host only |
| D1 | Session RAW; no multi-region story as multi-master |
| Turso | No `/sync` export path as multi-region product |
| No auto multi-gateway retry after indeterminate | Non-goal; select-time fallback ≠ post-attempt recovery |
| `approved` paid-like | Documented PayPal footgun; capture-required products must not ship on approval |
| Stripe future webhook `t` | Documented residual vs stripe-node |
| Envelope / secrets | Caller trust boundary; sanitizing persist helper exists |
| Core mutation idempotency vs lease-aware store dual shapes | Documented 0.x split |
| Moyasar/Paymob mutation idempotency | Operator must supply store+key |
| Tenant column | Scaffold only — **not** multi-tenant isolation |
| Payment amount major-unit number fields | 0.x; prefer Money |
| No automatic invent-paid | Held; live-green |

---

## Verdict rationale

| Criterion | Status |
| --- | --- |
| Live CI surface green | **Yes** |
| `confirmed_blocking` empty | **No** (7 correctness + 2 packaging) |
| Silent false-paid SDK path | Not proven |
| Cross-gateway money-status parity | **Broken** (Moyasar refund base) |
| Durable webhook recovery budget | **Broken** (ackAfterClaim attempts + availableAt + SQL drain) |
| Lease fencing parity | **Broken** (Redis fail; client clocks) |
| Publishable adapter install graph | **Broken** (private internal + full testkit) |

**Final verdict: FAIL.**

Do not treat workspace green tests as release readiness until P0 items are fixed or explicitly accepted with updated contracts, tests, and operator docs.

---

## Remediation (post fix-deep-audit-package)

Post-audit surgical fixes applied in-repo (append-only log; historical findings above are unchanged).

| ID | Severity | Domain | Status | Summary |
| --- | --- | --- | --- | --- |
| **N5** | Non-blocking residual (#16) | recon-routing-obs | **FIXED** | `moneyEquals` no longer uses raw amount-string equality. Amounts compare via `@paykernel/core` `toMinorUnits` (bigint minor units) so `"10"` ≡ `"10.00"` for the same currency; currency codes remain case-sensitive. Excess-precision / unparseable amounts stay unequal (fail-closed). Prevents false `manual_review` drift from decimal spelling alone. |

**Evidence (N5):**

- Code: `packages/reconciliation/src/compare.ts` — `moneyEquals` → `toMinorUnits(..., { allowZero: true, allowNegative: true })` after exact currency check.
- Tests: `packages/reconciliation/src/compare.test.ts` — `"10"` vs `"10.00"`, `"0"` vs `"0.00"`, KWD `"1.25"` vs `"1.250"`, currency case, excess precision.
- Docs: `packages/reconciliation/docs/reconciliation.md` § Compare; `packages/reconciliation/CHANGELOG.md` Unreleased.

**Still open (this remediation pass does not claim them):** blocking B1–B9 (Moyasar refund base, webhook attempt/`availableAt`/SQL-drain/Redis-fail fencing, client-clock residual, packaging ship blockers) and remaining non-blocking residuals other than N5.

---

## Adversarial gate (deep-audit fix verification)

| Field | Value |
| --- | --- |
| **Date (UTC)** | 2026-08-04 |
| **Mode** | READ-ONLY static re-verification (`read_file` / `grep`) — does not trust prior stream summaries |
| **Gate rule** | `pass=true` iff B1–B6 and B8–B9 are **FIXED** and no verify blocking failures; B7 may be **PARTIAL** with honest docs residual |

### Checklist (B1–B9)

| ID | Status | Evidence (absolute paths) |
| --- | --- | --- |
| **B1** Moyasar captured refund baseline | **FIXED** | `/home/shahin/Documents/projects/personal/packages/paykernel/packages/core/src/gateways/moyasar/moyasar.gateway.ts` — `refundBaseline = captured > 0 ? captured : amount`; full refund of partial capture → `refunded`. Regression: `moyasar.gateway.test.ts` (`maps full refund of partial capture to refunded (captured baseline)`; webhook twin). |
| **B2** moyasar.md docs baseline | **FIXED** | `/home/shahin/Documents/projects/personal/packages/paykernel/packages/core/docs/moyasar.md` — documents captured baseline; example `amount=10000, captured=3000, refunded=3000` → `refunded`. |
| **B3** ackAfterClaim attempt budget | **FIXED** | Engine parks with `fail({ restoreAttempt: true })` (`packages/webhooks/src/engine.ts`). Contract: `FailWebhookInput.restoreAttempt` in webhooks + store-contracts. Regression: `packages/webhooks/src/engine.backoff.test.ts` — `maxAttempts=3` + `ackAfterClaim` → 3 handler failures before `dead_letter`; after park `attempts === 0`. |
| **B4** claim availableAt gate | **FIXED** | Memory: `memory-store.ts` pending + future `availableAt` → `not_available`. Algorithm: `sql-foundation/src/claims/algorithm.ts` `decideWebhookClaim`. SQL templates: pending requires `available_at <= now`; expired claimed still reclaim. Redis: `WEBHOOK_CLAIM_LUA` `available_ms > nowMs` → `not_available`. Postgres/d1/turso/do claim paths map 0-row to `not_available`. Engine maps to `scheduled_for_retry` (no attempt burn). Tests in `engine.backoff.test.ts`. |
| **B5** SQL abandoned claimed+expired drain | **FIXED** | `listRetryable` / `get` soft-release `status=claimed AND lease_expires_at <= now` → `pending` then select pending due — postgres, sqlite, turso, d1, DO webhook stores + unit tests (`stores.unit.test.ts` B5/B4). Docs: postgres/sqlite crash-boundaries. |
| **B6** Redis fail requires unexpired lease | **FIXED** | `packages/store-redis/src/scripts/webhook-inbox.lua.ts` `WEBHOOK_FAIL_LUA`: `exp <= nowMs` → `lease_lost` (parity with complete). Integration: `integration.redis.test.ts` B6 describe. |
| **B7** clock fencing | **PARTIAL** | Not migrated to DB `NOW()` / Redis `TIME` as sole authority; still injectable client `now` / ARGV for FakeClock. **Honest residual documented:** sql-foundation atomic-claims, store-postgres/sqlite/d1/do crash-boundaries multi-host NTP, redis `scripts-atomicity.md` § TIME caveat (B7 residual). Acceptable under gate rule. |
| **B8** internal-sql-store private dep | **FIXED** | Publishable adapters runtime-depend on public `@paykernel/sql-foundation` + `@paykernel/store-contracts` only. No `package.json` of store-* lists `@paykernel/internal-sql-store`. `internal/sql-store` remains `"private": true` re-export shim. `sql-foundation` has `publishConfig.access: public`. |
| **B9** adapters no runtime testkit | **FIXED** | All store-* have `@paykernel/testkit` in **devDependencies** only. Production src imports `StoreLeaseLostError` / contracts from `@paykernel/store-contracts`; testkit imports confined to `*.test.ts`. |

### Non-blocking residuals (N1–N5)

| ID | Status | Note |
| --- | --- | --- |
| **N1** | **STILL_OPEN** | Shallow after-hook freeze (`BaseGateway.shallowCloneResult` still `{...result}` only); nested `references` / `nextAction` identity residual. |
| **N2** | **FIXED** | Poison path documented + regression: `NonRetryableHandlerError({ deadLetter: false })`; prefer default dead-letter. |
| **N3** | **STILL_OPEN** | PayPal `PAYMENT.REFUND.COMPLETED` map vs parse honesty drift still present. |
| **N4** | **STILL_OPEN** | Routing `AbortError` → `not_submitted` integrator footgun residual (`fallback.ts`). |
| **N5** | **FIXED** | Recon `moneyEquals` via `toMinorUnits` bigint minor units (see prior remediation). |

### Gate verdict

- B1–B6, B8–B9: **FIXED** (static code/docs/test evidence)
- B7: **PARTIAL** (documented honest residual only)
- Blocking list for this gate: **empty**
- **pass = true**

