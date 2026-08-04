# Phase 7 adversarial gate report

**Date (UTC):** 2026-08-02  
**Packages:** `@paykernel/core@0.8.0` (core), `@paykernel/testkit@0.1.0`  
**Monorepo root:** `paykernel` (`private: true`)  
**Reviewer stance:** fail-closed (missing evidence = blocking)  
**Verdict:** **PASS**

## Implementer claims under review

| Claim | Independent result |
| --- | --- |
| typecheck (core + testkit) | **PASS** — `bun run typecheck` exit 0 |
| typecheck:types | **PASS** — `bun run typecheck:types` exit 0 |
| 998 core+testkit tests | **PASS** — `bun test packages/core packages/testkit` → **998 pass, 0 fail**, 4126 expects, 32 files |
| coverage 98.95% funcs / 98.12% lines | **PASS** — measured **98.95% funcs / 98.12% lines** (`bun test --coverage packages/core`; 913 pass) |
| build + dist | **PASS** — `bun run build` exit 0; `dist/types/payment-event.d.ts`, `dist/types/webhook-event-map.d.ts`, root re-exports present |
| boundaries | **PASS** — `bun run check:boundaries` → workspace boundaries OK |
| validate:package (publint/attw/pack/smoke) | **PASS** — full `bash scripts/validate-package.sh` OK (typecheck → typecheck:types → test → build → pack → publint → attw → consumer smoke) |
| 14 stable names + `isStablePaymentEventType` | **PASS** — see 7.1 |
| `PaymentEvent` union `schemaVersion: '1'` | **PASS** — see 7.5 / A1 |
| `ProviderEventMetadata` | **PASS** — see 7.2 / A2 |
| `PersistedPaymentEventEnvelope` strip-raw | **PASS** — see 7.3 / A3 |
| opt-in `RawWebhookPayloadCodec` | **PASS** — see 7.4 |
| map + dual-write on 4 gateways + client safety-net | **PASS** — see dual-write section |
| `WebhookEvent.rawPayload` 0.x compat | **PASS** — required field retained; dual-write additive |
| `docs/webhook-events.md` | **PASS** — public contract present; packed in tarball |
| Phase 5 money + Phase 6 operation-result still green | **PASS** — focused suites 221 pass (money + operation-result + payment-event + acceptance) |
| verify failures `[]` / ok `true` | **Accepted** — independent re-run all green (not trusted alone) |

---

## Independent evidence (commands re-run)

| Check | Result |
| --- | --- |
| `bun test packages/core packages/testkit` | **998 pass, 0 fail** (32 files, 4126 expects) |
| `bun test --coverage packages/core` | **913 pass**; **98.95% funcs / 98.12% lines** |
| Phase 7 unit + acceptance | `payment-event.test.ts` + `webhook-events.acceptance.test.ts` (included in 998) |
| Phase 5/6 safety net (focused) | money + edge + provider-profiles + operation-result + acceptance + Phase 7 → **221 pass, 0 fail** |
| `bun run typecheck` | exit 0 (core + testkit) |
| `bun run typecheck:types` | exit 0 |
| `bun run build` | exit 0 (core + testkit; ESM + `.d.ts`) |
| `bun run check:boundaries` | exit 0 |
| `bash scripts/validate-package.sh` | typecheck → typecheck:types → test → build → pack → publint → attw → consumer smoke **OK** |
| core → testkit dep | **none** — core `dependencies` = `{ zod }` only; no `@paykernel/testkit` import under `packages/core/src` |

### Static / source audits

| Audit | Result |
| --- | --- |
| Stable catalog (14) | `STABLE_PAYMENT_EVENT_TYPES` exact roadmap list in `payment-event.ts` |
| Discriminated union | `PaymentEvent` arms for every stable name + `provider.unmapped`; all arms `schemaVersion: '1'` + `provider` |
| Provider metadata | `ProviderEventMetadata` with native `eventType`, ISO `occurredAt`/`receivedAt`, optional apiVersion/livemode/requestId |
| Envelope | `PersistedPaymentEventEnvelope` = `{ schemaVersion:'1', event, payloadHash, storedAt }`; `toPersistedPaymentEventEnvelope` + `stripRawFromPaymentEvent` + `assertNoSecretsInEnvelope` |
| Raw retention | `RawWebhookPayloadCodec` + `encryptRawWebhookPayload` + `RequestLocalWebhookContext` (not on envelope) |
| Mapping pure | `mapProviderEventTypeToStable` + per-gateway tables in `webhook-event-map.ts`; unknown → `provider.unmapped` |
| Dual-write sites | `attachPaymentEvent` in stripe / moyasar / paypal / paymob parse paths; client `handleWebhook` safety-net when `event.event === undefined` |
| 0.x WebhookEvent | Required `id/type/gateway/paymentId/gatewayPaymentId/status/timestamp/rawPayload` unchanged; additive optional dual-write fields |
| Public exports | `index.ts` + `dist/index.d.ts` re-export Phase 7 types/helpers |
| Docs | `packages/core/docs/webhook-events.md` (schema rules, mapping table, dual-write, envelope, raw retention) |
| Money float regression | No float conversion in `payment-event.ts`; Phase 5 money suite still green |

---

## Acceptance criteria (roadmap Phase 7)

### A1) handlers receive discriminated events — **PASS**

| Evidence | Detail |
| --- | --- |
| Type | `PaymentEvent` discriminated union on `type` (+ `schemaVersion: '1'`) in `packages/core/src/types/payment-event.ts` |
| Runtime attach | Built-in gateways call `attachPaymentEvent` from `parseWebhookEvent`; `PaymentClient.handleWebhook` attaches if gateway omitted dual-write |
| Switch narrowing | `payment-event.test.ts` + `webhook-events.acceptance.test.ts` exhaustive `switch (event.type)` with `never` default; arms cover `payment.succeeded` / `payment.failed` / `refund.completed` / `capture.completed` / `provider.unmapped` / setup / dispute |
| Type-level | `public-api.types.test.ts`: arm extraction, `@ts-expect-error` on wrong arm fields, switch exhaustiveness |
| Entity fields | succeeded → `payment`; failed → `payment` + `failure`; refund.completed → `refund` (no payment required) |

### A2) provider metadata remains available — **PASS**

| Evidence | Detail |
| --- | --- |
| Type | `ProviderEventMetadata` on every `PaymentEvent` arm via `PaymentEventBase` |
| Native type | `provider.eventType` set from `WebhookEvent.type` (provider-native); dual-write never rewrites `WebhookEvent.type` |
| Fields in tests | AC suite asserts `gateway`, `eventId`, `eventType`, ISO `occurredAt`/`receivedAt` for moyasar/stripe/paypal/paymob samples; `requestId` / `apiVersion` / `livemode` when supplied |
| Cross-check | Mapped events have `pe.type !== pe.provider.eventType`; unmapped keep native on metadata |

### A3) stable sanitized envelope for inbox adapters — **PASS**

| Evidence | Detail |
| --- | --- |
| Type | `PersistedPaymentEventEnvelope` with `schemaVersion: '1'`, `event`, `payloadHash`, `storedAt` |
| Builder | `toPersistedPaymentEventEnvelope` strips `rawResponse` / `clientSecret` via `stripRawFromPaymentEvent` |
| Secrets | `assertNoSecretsInEnvelope` forbids rawPayload/rawResponse/clientSecret/secret_token/webhook_secret; unredacted signature/hmac/authorization forbidden |
| Tests | AC suite JSON-stringifies envelope: no `rawPayload`, secrets, headers, `cs_live_xxx`; hash is 64 hex; stable across secret-value changes after redaction |
| Hash | `hashWebhookPayload` redacts known secret keys then canonical sha256 |

---

## Tasks 7.1–7.5 deliverables

### 7.1 Stable event names catalog — **PASS**

Exact list (14), locked by tests and `STABLE_PAYMENT_EVENT_TYPES`:

1. `payment.created`
2. `payment.processing`
3. `payment.authorized`
4. `payment.succeeded`
5. `payment.failed`
6. `payment.cancelled`
7. `capture.completed`
8. `refund.pending`
9. `refund.completed`
10. `refund.failed`
11. `payment_method.setup_completed`
12. `dispute.opened`
13. `dispute.updated`
14. `dispute.closed`

Plus escape hatch arm `provider.unmapped` (not in the stable set; `isStablePaymentEventType` returns false).

### 7.2 ProviderEventMetadata — **PASS**

Shape matches roadmap: `gateway`, `eventId`, `eventType`, optional `apiVersion`/`livemode`/`requestId`, ISO `occurredAt`/`receivedAt`. Built via `buildProviderEventMetadata`.

### 7.3 PersistedPaymentEventEnvelope — **PASS**

Shape matches roadmap. Excludes raw payloads, secrets, headers, signatures by default.

### 7.4 Explicit raw payload retention — **PASS**

- Request-local: required `WebhookEvent.rawPayload` (deprecated for persistence).
- Opt-in encrypted: `RawWebhookPayloadCodec` + `encryptRawWebhookPayload` → `EncryptedRawPayloadRecord` (`schemaVersion: '1'`, ciphertext, payloadHash, optional codecId).
- Envelope path never embeds raw/ciphertext by default (AC tests).

### 7.5 schemaVersion `'1'` + compatibility docs — **PASS**

- `PAYMENT_EVENT_SCHEMA_VERSION = '1'`.
- Docs: `packages/core/docs/webhook-events.md` (compatibility rules: switch schemaVersion then type; additive fields OK; meaning changes need new schemaVersion; never silent rename; native type on provider.eventType only).
- Dual-write migration path documented.

---

## Dual-write + mapping matrix

| Path | Evidence |
| --- | --- |
| Stripe | `stripe.gateway.ts` `attachPaymentEvent` with checkout `mapContext`; tests: PI succeeded/failed/cancelled, charge.refunded, invoice unmapped |
| Moyasar | `moyasar.gateway.ts` attach after secret_token strip; tests: payment_paid/failed/authorized/refunded + redacted raw |
| PayPal | `paypal.gateway.ts` attach; tests: CAPTURE.COMPLETED → `capture.completed` (not succeeded), refund.* |
| Paymob | `paymob.gateway.ts` attach with flags context; tests: TRANSACTION success/fail/void/refund, TOKEN setup |
| Client safety-net | `client.ts` lines attach when `event.event === undefined`; client tests custom gateway → unmapped dual-write |
| Pure mapper | stripe/moyasar/paypal/paymob tables; custom gateway unknown → unmapped; already-stable names idempotent |

---

## Logical anti-pattern audit (must not pass if present)

| Anti-pattern | Result |
| --- | --- |
| unknown → `payment.succeeded` | **Not found.** Invoice/subscription/REVERSED/empty type/custom gateway/`checkout.session.completed` without paid context → `provider.unmapped`. AC suite locks this. PayPal capture maps to `capture.completed`, not succeeded. |
| secrets in envelope | **Not found.** strip + assert + hash redaction; Moyasar strips `secret_token` from request-local raw before attach. |
| `provider.eventType` rewritten away | **Not found.** Metadata uses legacy `event.type`; dual-write leaves `WebhookEvent.type` native. |
| breaking 0.x `WebhookEvent` | **Not found.** Required fields retained including `rawPayload`; dual-write fields optional. |
| missing discrimination | **Not found.** Union + exhaustive switch tests + type-level arm checks. |
| float money reintroduction | **Not found.** Phase 5 money suites green; payment-event carries amounts as provided numbers without float conversion helpers. |

### Non-blocking observations (not acceptance failures)

1. **File-level coverage** on `payment-event.ts` (~92.97% lines) and `webhook-event-map.ts` (~91.13% lines) is below package aggregate; package totals still meet policy (98.95% / 98.12%). Residual uncovered lines are defensive branches (clone fallbacks, rare refund status paths, Paymob flag edge arms).
2. **`encryptRawWebhookPayload`** passes string/Buffer plaintext to the app codec without further redaction (object path redacts). Documented as app-owned crypto for opt-in raw retention; envelope path remains secret-free.
3. **Moyasar free-form fallback:** unknown Moyasar types with `status: paid` map via status fallback to `payment.succeeded`. This is intentional status-assisted mapping for free-form types, not inventing success from type alone without status (AC cases use pending/unmapped without paid status).

---

## Phase 0–6 safety net

| Area | Result |
| --- | --- |
| Full core+testkit suite | 998 pass |
| Phase 5 money | money + edge + provider-profiles included in focused green run |
| Phase 6 operation-result | unit + acceptance included in focused green run |
| Boundaries / no core→testkit | green |
| Package publish surface | validate:package green; `docs/webhook-events.md` in tarball |

---

## Checklist

- [x] A1 handlers receive discriminated events
- [x] A2 provider metadata remains available
- [x] A3 sanitized persistable envelope
- [x] 7.1 14 stable names + `isStablePaymentEventType`
- [x] 7.2 `ProviderEventMetadata`
- [x] 7.3 `PersistedPaymentEventEnvelope` strip-raw
- [x] 7.4 opt-in raw codec
- [x] 7.5 schemaVersion `'1'` + docs
- [x] Dual-write on 4 gateways + client safety-net
- [x] `mapProviderEventTypeToStable` pure tables
- [x] 0.x `WebhookEvent.rawPayload` compatibility
- [x] typecheck + typecheck:types
- [x] 998 core+testkit tests
- [x] coverage ≥ policy (98.95% / 98.12%)
- [x] build + dist Phase 7 types
- [x] check:boundaries
- [x] validate:package
- [x] no core→testkit dependency
- [x] anti-patterns not present
- [x] Phase 5 money + Phase 6 operation-result still green

---

## Verdict

**PASS** — Phase 7 typed/versioned webhook events meet roadmap acceptance criteria A1–A3 and tasks 7.1–7.5. Independent re-runs of tests, typecheck, typecheck:types, coverage, build, boundaries, and full package validation are green. No blocking logical bugs found under the Phase 7 anti-pattern list.
