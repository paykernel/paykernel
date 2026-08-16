let meta = #{
    name: "paykernel-audit-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every 2026-08-16 deep-audit finding",
    phases: [
        #{ title: "Critic", detail: "reconfirm every audit ID against current code" },
        #{ title: "Fix", detail: "parallel non-overlapping streams for all residual findings" },
        #{ title: "Integrate", detail: "typecheck, tests, cross-stream consistency" },
        #{ title: "Verify", detail: "typecheck + tests + money-status invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "fix remaining blockers if any" },
        #{ title: "Report", detail: "write fix-result under docs/audits" },
    ],
    when_to_use: "After paykernel-deep-audit SHIP_BLOCKED report dated 2026-08-16; fix every residual ID",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
        "fixed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "invariants_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "invariants_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "summary": #{ "type": "string" },
        "report_path": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["ok", "report_path", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "report_path": #{ "type": "string" },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/paykernel"
} else {
    args.root
};

let audit_doc = root + "/docs/audits/deep-audit-2026-08-16.md";

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: reconfirming 2026-08-16 deep-audit findings in " + root);

let p_critic = "";
p_critic += "Recheck findings from " + audit_doc + " against current code at " + root + ".\n";
p_critic += "READ-ONLY. Use read_file and grep. For each ID: STILL PRESENT or ALREADY FIXED with file:line.\n";
p_critic += "Do not edit files. Do not commit.\n\n";
p_critic += "MUST CHECK BLOCKING (P0 + P1 ship blockers):\n";
p_critic += "WEBHOOKS-1 (P0): inbox key is WebhookEvent.id; Paymob redirect TRANSACTION_RESPONSE and processed TRANSACTION share txn id so processing ACK swallows later paid\n";
p_critic += "CORE-1: inferRefundOperationOutcome forges failed on success:false + pending (double-refund)\n";
p_critic += "STRIPE-1: refund.failed / pending / canceled overwrite payment status instead of refund_failed / refund_pending\n";
p_critic += "STRIPE-2: payment_intent.succeeded ignores charge refunds; dual-writes paid after money returned\n";
p_critic += "PAYPAL-1: PAYMENT.CAPTURE.REFUNDED fail-opens full refunded on refund-shaped resources\n";
p_critic += "PAYPAL-3: ORDER.COMPLETED invents paid from related_ids.capture_id without nested captures\n";
p_critic += "PAYMOB-2: Intention HTTP 200 missing id / checkout URL throws GatewayApiError and releases create fence\n\n";
p_critic += "MUST CHECK OTHER P1:\n";
p_critic += "CORE-2 after-hook composition forwards unfrozen money; CORE-3 handleWebhook Promise-as-verified;\n";
p_critic += "CORE-4 3-field PaymentEvent skips demotes; MONEY-1 missing JMD/XCG/XAD;\n";
p_critic += "PAYMOB-1 is_refund/is_void dropped when is_refunded/is_voided present-and-false;\n";
p_critic += "WEBHOOKS-2 durable missing payload = invalid_webhook; WEBHOOKS-3 parse InvalidWebhookError = forgery;\n";
p_critic += "WEBHOOKS-4 inline no payloadRef then processRetryable dead-letters;\n";
p_critic += "REDIS-1 renew does not rescore due/retry ZSET; RECON-1 auth-hold capturedAmount=0 drift;\n";
p_critic += "RECON-2 mark_consistent ignores capture/refund on authorized/partial; RECON-3 maxAttempts dead-letters retry_later;\n";
p_critic += "PERF-1 Redis SCAN+EVAL every key; PERF-2 SQL unbounded UPDATE of expired claimed rows.\n\n";
p_critic += "Also note residual P2 if still present: CORE-5/6/7/8 MONEY-2/3 PAYPAL-2 PAYMOB-3/4 MOYASAR-1/2/3\n";
p_critic += "WEBHOOKS-5 SQLFOUND-1 RECON-4 ROUTE-1 TESTKIT-1/2/3/4 OBS-1/2 PKG-1 PERF-3/4/5/6/7.\n";
p_critic += "Return confirmed[], already_fixed[], summary. Each confirmed entry is ID — one-line evidence.\n";

let critic = agent(p_critic, #{
    label: "critic:reconfirm",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
}

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Fixing residual 2026-08-16 findings in parallel streams");

let common = "";
common += "Repo root: " + root + "\n";
common += "Audit source of truth: " + audit_doc + " — read YOUR stream section before editing.\n";
common += "Package: PayKernel monorepo (Bun + TypeScript). Do NOT commit. Do NOT push.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; update/add unit tests that currently lock wrong behavior;\n";
common += "re-read changed regions; prefer existing PaymentStatus values (partially_captured, partially_refunded,\n";
common += "refund_pending, refund_failed, refund_completed, setup_completed, paid, pending, processing, authorized);\n";
common += "use isPaidOutcome / domain-status patterns already in codebase; fail-closed on incomplete money snapshots;\n";
common += "ALWAYS publish currency together with major-unit amount fields on GatewayPaymentResult and dual-write entities;\n";
common += "Run bun test on touched test files when possible. Skip items critic proves already fixed.\n";
common += "OWN FILES ONLY — do not edit other streams' files.\n";
common += "Return JSON {ok, files_changed, summary, notes, fixed_ids}.\n";

// A — Stripe
let p_a = "";
p_a += common;
p_a += "STREAM A — STRIPE. OWN:\n";
p_a += "- " + root + "/packages/core/src/gateways/stripe/**\n";
p_a += "- " + root + "/packages/core/docs/stripe.md\n";
p_a += "BLOCKING:\n";
p_a += "STRIPE-1: mapStripeRefundWebhookStatus and refund.failed case must map failed/canceled -> refund_failed,\n";
p_a += "  in-flight -> refund_pending. Do NOT overwrite payment status with failed/pending.\n";
p_a += "  Evidence: stripe.gateway.ts mapStripeRefundWebhookStatus ~851-854; refund.failed hardcode ~2231-2232.\n";
p_a += "  Domain already has refund_failed / refund_pending (payment.types.ts). PayPal already maps REFUND.FAILED correctly.\n";
p_a += "STRIPE-2: succeededPaymentIntentWebhookStatus must read latest_charge.amount_refunded / refunded.\n";
p_a += "  If charge refunded > 0 map refunded / partially_refunded like getPayment (~1591-1607).\n";
p_a += "  If latest_charge is an unexpanded id, fail-closed to processing (do not invent paid).\n";
p_a += "  Evidence: stripe.gateway.ts ~2676-2691. Flip tests that expect paid when refund fields absent on hydrated PI.\n";
p_a += "Add tests: refund.failed -> refund_failed not failed; PI.succeeded with amount_refunded -> not paid.\n";

// B — PayPal
let p_b = "";
p_b += common;
p_b += "STREAM B — PAYPAL. OWN:\n";
p_b += "- " + root + "/packages/core/src/gateways/paypal/**\n";
p_b += "- " + root + "/packages/core/docs/paypal.md\n";
p_b += "BLOCKING:\n";
p_b += "PAYPAL-1: PAYMENT.CAPTURE.REFUNDED must NOT default to full refunded.\n";
p_b += "  Treat resource_type=refund + COMPLETED as this-op refund, not capture settlement.\n";
p_b += "  Run remaining-held rewrite or fail-closed to partially_refunded / processing when capture totals unknown.\n";
p_b += "  Evidence: paypal.gateway.ts mapWebhookStatus ~2921-2929; extractSingleCaptureWebhookHeldAmount ~2649-2655.\n";
p_b += "PAYPAL-3: Do not invent a COMPLETED capture from supplementary_data.related_ids.capture_id.\n";
p_b += "  Absent nested purchase_units[].payments.captures -> processing (same as bare COMPLETED).\n";
p_b += "  Evidence: parseWebhookEvent ~1234-1249; mapPaymentResultStatus ~3036-3049.\n";
p_b += "P2: PAYPAL-2 — docs say PAYMENT.REFUND.COMPLETED dual-writes refund.completed; code emits refund.pending.\n";
p_b += "  Align docs in paypal.md with code (or emit refund.completed if money-honest and tested). Prefer code+docs match.\n";
p_b += "Add tests: refund-resource COMPLETED partial amount not full refunded; ORDER.COMPLETED + capture_id only not paid.\n";

// C — Paymob
let p_c = "";
p_c += common;
p_c += "STREAM C — PAYMOB. OWN:\n";
p_c += "- " + root + "/packages/core/src/gateways/paymob/**\n";
p_c += "- " + root + "/packages/core/docs/paymob.md\n";
p_c += "BLOCKING:\n";
p_c += "PAYMOB-2: Intention HTTP 200 missing id / checkout URL must throw PaymobIndeterminateResponseError\n";
p_c += "  (or otherwise keep the idempotency fence), matching capture/refund requireMutationBoolean.\n";
p_c += "  Evidence: createPaymentViaIntention ~545-563; requireString ~3174-3179 throws GatewayApiError;\n";
p_c += "  executeIdempotent only fences isPaymobIndeterminateError ~2959-2986.\n";
p_c += "P1 residual PAYMOB-1: do not drop is_refund / is_void when is_refunded / is_voided are present-and-false.\n";
p_c += "  Use HMAC-covered has_parent_transaction / action flags. Child refund/void + success must not fall through to paid.\n";
p_c += "  Evidence: sanitizeWebhookTransactionForStatus ~1393-1398; mapTransactionStatus ~1991-2060.\n";
p_c += "P2 PAYMOB-3: honor HMAC-covered error_occured in status mapping (signed error + success must not look paid).\n";
p_c += "Add tests: Intention 200 empty id keeps fence / retry same key does not second-create;\n";
p_c += "  is_refund true + is_refunded false + success not paid; error_occured true not payment.succeeded.\n";
p_c += "Do NOT change webhook event.id identity here — STREAM E owns inbox key / WEBHOOKS-1 composition.\n";
p_c += "You MAY add a Paymob-specific event identity helper used by parseWebhookEvent (e.g. suffix type on id)\n";
p_c += "if that is the cleanest WEBHOOKS-1 fix and you coordinate: prefer changing event.id to include type\n";
p_c += "(redirect vs TRANSACTION) so deriveWebhookEventKey no longer collides. That IS in your OWN files.\n";
p_c += "Recommended WEBHOOKS-1 half: set redirect id to payload.id + ':redirect' or type-qualified id;\n";
p_c += "processed TRANSACTION keeps obj.id. Update paymob.md. Engine stays in stream E.\n";

// D — Moyasar
let p_d = "";
p_d += common;
p_d += "STREAM D — MOYASAR. OWN:\n";
p_d += "- " + root + "/packages/core/src/gateways/moyasar/**\n";
p_d += "- " + root + "/packages/core/docs/moyasar.md\n";
p_d += "- " + root + "/packages/core/src/types/config.types.ts ONLY for MoyasarConfig JSDoc (MOYASAR-2)\n";
p_d += "P2:\n";
p_d += "MOYASAR-1: payment_voided webhooks must be fail-closed on residual paid / authorized snapshots.\n";
p_d += "  Evidence: moyasar.gateway.ts ~1157-1167, 1844-1856.\n";
p_d += "MOYASAR-2: idempotencyStore is required at runtime for mutations — type it required or fail at construct with a clear error;\n";
p_d += "  fix JSDoc that says optional. Evidence: config.types.ts ~33-40; moyasar.gateway.ts ~354-380.\n";
p_d += "MOYASAR-3: stop advertising raw creditcard sources the adapter rejects (JSDoc / types in moyasar files only).\n";
p_d += "Add tests for void residual honesty and required store.\n";

// E — Webhooks + client verify/parse
let p_e = "";
p_e += common;
p_e += "STREAM E — WEBHOOKS engine + client handleWebhook. OWN:\n";
p_e += "- " + root + "/packages/webhooks/src/**\n";
p_e += "- " + root + "/packages/webhooks/docs/**\n";
p_e += "- " + root + "/packages/webhooks/README.md\n";
p_e += "- " + root + "/packages/core/src/client.ts\n";
p_e += "- " + root + "/packages/core/docs/webhooks.md\n";
p_e += "- " + root + "/packages/core/docs/webhook-events.md\n";
p_e += "BLOCKING P0 WEBHOOKS-1: inbox key is gateway:WebhookEvent.id. Paymob redirect and processed share txn id.\n";
p_e += "  If stream C already type-qualifies Paymob event.id, document the key and add an inbox test that two\n";
p_e += "  Paymob events with same txn id but different type are NOT already_completed.\n";
p_e += "  If C did not change event.id, engine must not complete payment.processing redirect as terminal for Paymob,\n";
p_e += "  OR deriveWebhookEventKey must include event type / notification class for paymob.\n";
p_e += "  Docs currently tell integrators to inbox-dedupe on event.id and no-op redirect — that combo is the P0.\n";
p_e += "  Evidence: engine.ts deriveWebhookEventKey ~1031; already_completed ~1111-1112; paymob parse ids.\n";
p_e += "WEBHOOKS-2: missing durable payload / unrefusable snapshot is NOT invalid_webhook (not 400 forgery).\n";
p_e += "  Map to retryable / server outcome. Evidence: engine.ts ~1061-1089. README ~95-97.\n";
p_e += "WEBHOOKS-3: isForgeryClassVerifyError must NOT treat all InvalidWebhookError as forgery.\n";
p_e += "  Parse-stage InvalidWebhookError (Paymob/Moyasar parse messages) -> retryable, matching handleWebhook reclass.\n";
p_e += "  Evidence: engine.ts ~220-239, 363-369; client.ts handleWebhook ~747-765 already reclassifies.\n";
p_e += "WEBHOOKS-4: persist payloadRef on inline claims OR refuse processRetryable of inline rows without dead-lettering paid.\n";
p_e += "  Evidence: engine.ts ~1061-1082, 1320-1356.\n";
p_e += "CORE-3 (client.ts): if verifyWebhookAsync absent, await / boolean-check verifyWebhook.\n";
p_e += "  If it returns a Promise, await it. A Promise must not count as verified. Evidence: client.ts ~720-726.\n";
p_e += "CORE-4 (client.ts): reject thin 3-field PaymentEvent before skipping demoteIncomplete* dual-write.\n";
p_e += "  Evidence: payment-event.ts isPaymentEvent ~213-221; client.ts ~773-783. You may edit payment-event.ts\n";
p_e += "  ONLY if needed to tighten isPaymentEvent (coordinate: stream G will not edit payment-event.ts).\n";
p_e += "P2: WEBHOOKS-5 docs honesty (lease_lost / not_available / hash-source). CORE-8: do not tell integrators\n";
p_e += "  to call isPaidOutcome on WebhookEvent (always false) — fix webhooks.md.\n";
p_e += "  PAYMOB-4: webhook-events.md is_capture + success is processing not capture.completed — align docs.\n";
p_e += "Add tests: Paymob redirect then processed not duplicate_completed; parse InvalidWebhookError not forgery;\n";
p_e += "  missing durable payload retryable; async verifyWebhook is awaited; thin PaymentEvent still demoted.\n";

// F — Stores + perf + sql-foundation
let p_f = "";
p_f += common;
p_f += "STREAM F — STORES + PERF + sql-foundation. OWN:\n";
p_f += "- " + root + "/packages/store-redis/src/**\n";
p_f += "- " + root + "/packages/store-postgres/src/**\n";
p_f += "- " + root + "/packages/store-sqlite/src/**\n";
p_f += "- " + root + "/packages/store-d1/src/**\n";
p_f += "- " + root + "/packages/store-turso/src/**\n";
p_f += "- " + root + "/packages/store-durable-objects/src/**\n";
p_f += "- " + root + "/packages/sql-foundation/src/**\n";
p_f += "- " + root + "/packages/sql-foundation/docs/**\n";
p_f += "P1 REDIS-1: WEBHOOK_RENEW_LUA / RECON_RENEW_LUA must rescore due/retry ZSET to the new lease_expires_ms.\n";
p_f += "  Evidence: webhook-inbox.lua.ts ~206-216 vs ZADD at claim ~68-70; reconciliation.lua.ts ~245-256 vs ~183-186.\n";
p_f += "P1 PERF-1: drop per-poll full SCAN+EVAL of every record in listDue/listRetryable.\n";
p_f += "  Use the ZSET scored at lease expiry (after REDIS-1 rescore). SCAN only as a rare repair, not every poll.\n";
p_f += "  Evidence: store-redis/src/stores/shared.ts ~134-167.\n";
p_f += "P1 PERF-2: bound SQL expired-lease UPDATE (LIMIT or only rows that will be listed). Do not UPDATE all expired claimed.\n";
p_f += "  Apply across postgres, d1, sqlite, turso, durable-objects webhook + recon listDue/listRetryable.\n";
p_f += "P2 PERF-3: add composite indexes for listDue/listRetryable predicates if definitions.ts can do it safely.\n";
p_f += "P2 PERF-4: avoid N+1 GET after ZRANGE (batch if cheap).\n";
p_f += "P2 PERF-5: DO listDue should not wake every partition at full limit if a cheaper fan-in exists; otherwise document.\n";
p_f += "P2 SQLFOUND-1: atomic-claims.md must not deny idle hash supersede that decideWebhookClaim implements.\n";
p_f += "P2 PKG-1: do not root-export createFakeExecutor next to migrate() if that trains false success — move to test-only export.\n";
p_f += "Add tests: renew updates ZSET score; listDue does not SCAN all keys on the happy path.\n";

// G — Core + money
let p_g = "";
p_g += common;
p_g += "STREAM G — CORE orchestration + MONEY. OWN:\n";
p_g += "- " + root + "/packages/core/src/types/operation-result.ts\n";
p_g += "- " + root + "/packages/core/src/types/webhook-event-map.ts\n";
p_g += "- " + root + "/packages/core/src/types/validation.ts if needed\n";
p_g += "- " + root + "/packages/core/src/hooks/**\n";
p_g += "- " + root + "/packages/core/src/utils/currency.ts\n";
p_g += "- " + root + "/packages/core/src/utils/idempotency.ts\n";
p_g += "- " + root + "/packages/core/src/utils/logger.ts\n";
p_g += "- " + root + "/packages/core/src/utils/*.test.ts\n";
p_g += "- " + root + "/packages/core/src/types/*.test.ts\n";
p_g += "- " + root + "/packages/core/src/gateways/base.gateway.ts\n";
p_g += "- " + root + "/packages/core/docs/operation-results.md\n";
p_g += "- " + root + "/packages/core/docs/money.md\n";
p_g += "Do NOT edit client.ts or payment-event.ts (stream E). Do NOT edit config.types.ts (stream D).\n";
p_g += "BLOCKING CORE-1: inferRefundOperationOutcome must apply P610-INF-2:\n";
p_g += "  success:false + pending/processing/approved (or omitted success with pending) -> indeterminate, not failed.\n";
p_g += "  Evidence: operation-result.ts infer path ~329-345 vs inferRefundOperationOutcome ~969-970.\n";
p_g += "CORE-2: restore/freeze money-identity BETWEEN composed after-hooks, not only on client return path.\n";
p_g += "  Evidence: hooks.manager.ts ~173-204, 394-430; base.gateway.ts restoreMoneyIdentityFields ~511-521.\n";
p_g += "MONEY-1: add JMD (2), XCG (2), XAD (2) to ISO tables in currency.ts. Downstream Stripe/PayPal unknown-code paths inherit.\n";
p_g += "P2 CORE-5: applyOutcomeToGatewayResult must not persist success:true + outcome succeeded with failed/pending status.\n";
p_g += "P2 CORE-6: stable-name short-circuit must not attach payment.succeeded when domain status is failed/pending.\n";
p_g += "P2 CORE-7: post-submit create/OTP abort/timeout must not use gatewayId unknown if a real id exists; otherwise document.\n";
p_g += "P2 MONEY-2: fingerprintParams must distinguish Date vs ISO string (no collision).\n";
p_g += "P2 MONEY-3: redact() must catch embedded sk_live_ / PAN in hookError strings, not only whole-string leaves.\n";
p_g += "P2 PERF-6 if cheap in logger/client helpers you own — do not edit stripe.gateway.ts.\n";
p_g += "Add unit tests: refund pending !success is indeterminate; after-hook later handler sees frozen money;\n";
p_g += "  JMD/XCG/XAD known; Date vs ISO fingerprint differs; redact embedded sk_live_.\n";

// H — Recon + routing
let p_h = "";
p_h += common;
p_h += "STREAM H — RECONCILIATION + ROUTING. OWN:\n";
p_h += "- " + root + "/packages/reconciliation/src/**\n";
p_h += "- " + root + "/packages/reconciliation/docs/**\n";
p_h += "- " + root + "/packages/routing/src/**\n";
p_h += "- " + root + "/packages/routing/docs/**\n";
p_h += "P1 RECON-1: compareSnapshots must not treat auth-hold capturedAmount=0 vs local.amount as money drift.\n";
p_h += "  Gate on status: authorized / requires_capture / approved with captured 0 is consistent, not apply_drift_review.\n";
p_h += "  Evidence: compare.ts ~125-138; policy.ts ~444-521.\n";
p_h += "P1 RECON-2: mark_consistent must NOT ignore capture/refund totals on authorized / partially_captured / partially_refunded.\n";
p_h += "  Incremental capture while authorized + capturedAmount growing is drift / unsafe, not mark_consistent safe:true.\n";
p_h += "  Evidence: policy.ts ~242-266, 140-145, 406-416, 437-441.\n";
p_h += "P1 RECON-3: retry_later in-flight settlement must not dead-letter at default maxAttempts.\n";
p_h += "  Prefer: retry_later does not consume the manual-review budget, or use a much higher cap / no dead-letter for retry_later.\n";
p_h += "  Evidence: policy.ts ~393-403; scheduler.ts ~211-219, 419-430.\n";
p_h += "P2 RECON-4: scheduling.md must not complete paid/failed without applying the local update.\n";
p_h += "P2 ROUTE-1: document or fix complementary amount-split + fallback honesty-block (fail-closed is OK if explained).\n";
p_h += "P2 PERF-7: if cheap, reduce list-then-serial-claim oversample in processDue; do not break claim fencing.\n";
p_h += "Add tests: auth-hold amount vs captured 0 not drift; incremental capture not mark_consistent;\n";
p_h += "  retry_later past 10 claims is not markManualReview solely due to attempts.\n";

// I — Testkit + observability
let p_i = "";
p_i += common;
p_i += "STREAM I — TESTKIT + OBSERVABILITY. OWN:\n";
p_i += "- " + root + "/packages/testkit/src/**\n";
p_i += "- " + root + "/packages/observability/src/**\n";
p_i += "- " + root + "/packages/observability/docs/**\n";
p_i += "P2 TESTKIT-1: mock capturePayment must not settle money after void / failed / pending.\n";
p_i += "TESTKIT-2: capture/refund convert majors with payment currency, not caller currency.\n";
p_i += "TESTKIT-3: parseWebhookEvent must not default missing type to payment_paid / payment.succeeded.\n";
p_i += "TESTKIT-4: paymentStatusToOperationOutcome must not map refund_failed (or unknown) to succeeded.\n";
p_i += "  Evidence: mock-gateway.ts ~1362-1415, 1369-1373, 1535-1539, 1793-1808; outcomes.ts ~183-207.\n";
p_i += "P2 OBS-1: OTEL bridge must sanitize span.end() status.message.\n";
p_i += "OBS-2: do not export cs_live_ / client-secret values on allow-listed span keys.\n";
p_i += "  Evidence: otel.ts ~69-90; instrumentation.ts ~155-182.\n";
p_i += "Update package tests.\n";

// J — Audit bookkeeping
let p_j = "";
p_j += common;
p_j += "STREAM J — DOCS audit bookkeeping. OWN:\n";
p_j += "- " + root + "/docs/audits/** only\n";
p_j += "Write " + root + "/docs/audits/deep-audit-fix-pass-2026-08-16.md summarizing stream ownership and residual IDs.\n";
p_j += "List P0: WEBHOOKS-1.\n";
p_j += "List P1 blocking: CORE-1, STRIPE-1, STRIPE-2, PAYPAL-1, PAYPAL-3, PAYMOB-2.\n";
p_j += "List P1 other: CORE-2/3/4, MONEY-1, PAYMOB-1, WEBHOOKS-2/3/4, REDIS-1, RECON-1/2/3, PERF-1/2.\n";
p_j += "List P2 pack: CORE-5/6/7/8, MONEY-2/3, PAYPAL-2, PAYMOB-3/4, MOYASAR-1/2/3, WEBHOOKS-5,\n";
p_j += "SQLFOUND-1, RECON-4, ROUTE-1, TESTKIT-1/2/3/4, OBS-1/2, PKG-1, PERF-3/4/5/6/7.\n";
p_j += "Do NOT edit packages/**.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:stripe", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:paypal", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:paymob", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:moyasar", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:webhooks", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:stores-perf", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:core-money", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_h, label: "fix:recon-routing", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_i, label: "fix:testkit-obs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_j, label: "fix:docs-audit", capability_mode: "all", output_schema: implement_schema },
];

let impl_results = parallel(jobs);
let impl_ok_count = 0;
let impl_fail_count = 0;
let impl_i = 0;
if impl_results != () {
    while impl_i < impl_results.len() {
        let r = impl_results[impl_i];
        if r != () && r.success && r.output != () && r.output.ok == true {
            impl_ok_count += 1;
            log("OK implement: " + r.output.summary);
        } else {
            impl_fail_count += 1;
            log("FAIL implement slot " + impl_i.to_string());
        }
        impl_i += 1;
    }
}
log("Implement done ok=" + impl_ok_count.to_string() + " fail=" + impl_fail_count.to_string());

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
let p_int = "";
p_int += "Integrate deep-audit-fix-gate streams in " + root + ". Do NOT commit.\n";
p_int += "1) git status / diff — fix any broken TS from parallel streams.\n";
p_int += "2) bun run typecheck across monorepo — fix all errors from our changes.\n";
p_int += "3) bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso until green (known sql-foundation bun:sqlite multi-connection WAL flake may remain — isolate if needed).\n";
p_int += "4) Cross-check invariants from " + audit_doc + ":\n";
p_int += "   - WEBHOOKS-1: Paymob redirect then processed TRANSACTION not already_completed / not duplicate_completed\n";
p_int += "   - CORE-1: refund success:false + pending is indeterminate, not failed\n";
p_int += "   - STRIPE-1: refund.failed -> refund_failed not payment failed\n";
p_int += "   - STRIPE-2: PI.succeeded with charge amount_refunded not paid\n";
p_int += "   - PAYPAL-1: CAPTURE.REFUNDED refund-resource not full refunded\n";
p_int += "   - PAYPAL-3: ORDER.COMPLETED + capture_id only not paid\n";
p_int += "   - PAYMOB-2: Intention 200 missing id keeps fence\n";
p_int += "5) Update " + root + "/docs/audits/deep-audit-fix-pass-2026-08-16.md with what landed vs remaining.\n";
p_int += "6) Prefer fail-closed money status; flip any remaining tests locking old lies for blocking IDs.\n";
p_int += "Return {ok, files_changed, summary, notes, fixed_ids}.\n";

let int_result = agent(p_int, #{
    label: "integrate:typecheck-test",
    capability_mode: "all",
    output_schema: implement_schema,
});
if int_result == () || !int_result.success || (int_result.output != () && int_result.output.ok != true) {
    log("Integrate reported issues — verify will surface details");
} else if int_result.output != () {
    log("Integrate OK: " + int_result.output.summary);
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify 2026-08-16 deep-audit fixes in " + root + " with command evidence and file reads.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso\n";
p_ver += "3) Invariant greps/reads (must hold for residual P0/P1):\n";
p_ver += "   - WEBHOOKS-1: Paymob redirect id and processed TRANSACTION id no longer collide as the same inbox key\n";
p_ver += "   - CORE-1: inferRefundOperationOutcome does not map !success+pending to failed\n";
p_ver += "   - STRIPE-1: refund.failed maps to refund_failed\n";
p_ver += "   - STRIPE-2: succeeded PI path consults amount_refunded or fail-closes\n";
p_ver += "   - PAYPAL-1: CAPTURE.REFUNDED does not default every other status to refunded\n";
p_ver += "   - PAYPAL-3: related_ids.capture_id alone does not invent paid\n";
p_ver += "   - PAYMOB-2: Intention missing id/url is indeterminate / fenced\n";
p_ver += "   - CORE-3: verifyWebhook Promise is awaited\n";
p_ver += "   - REDIS-1: renew rescored ZSET; RECON-1/2/3 status-aware / retry_later not dead-lettered at 10\n";
p_ver += "   - PERF-1/2: no full SCAN every poll; SQL expired UPDATE bounded\n";
p_ver += "Return typecheck_ok, tests_ok, invariants_ok, failures[], commands_run[], summary, ok=all three true.\n";

let ver = agent(p_ver, #{
    label: "verify:typecheck-test-invariants",
    capability_mode: "all",
    output_schema: verify_schema,
});

let typecheck_ok = false;
let tests_ok = false;
let invariants_ok = false;
let ver_failures = [];
if ver != () && ver.success && ver.output != () {
    typecheck_ok = ver.output.typecheck_ok;
    tests_ok = ver.output.tests_ok;
    invariants_ok = ver.output.invariants_ok;
    if ver.output.failures != () {
        ver_failures = ver.output.failures;
    }
    log("Verify: " + ver.output.summary);
} else {
    log("Verify agent failed");
    ver_failures.push("verify agent failed or empty");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarially gate PayKernel 2026-08-16 fix-gate in " + root + ".\n";
p_gate += "Skeptical: read actual code with read_file/grep. Do NOT trust implement summaries.\n";
p_gate += "BLOCKING if still broken:\n";
p_gate += "WEBHOOKS-1: Paymob redirect still completes the same inbox key as processed paid\n";
p_gate += "CORE-1: refund !success+pending still failed\n";
p_gate += "STRIPE-1: refund.failed still overwrites payment status to failed\n";
p_gate += "STRIPE-2: PI.succeeded still ignores charge refunds\n";
p_gate += "PAYPAL-1: CAPTURE.REFUNDED still fail-opens full refunded\n";
p_gate += "PAYPAL-3: ORDER.COMPLETED still invents paid from capture_id string\n";
p_gate += "PAYMOB-2: Intention 200 missing id still releases create fence\n";
p_gate += "P0: typecheck or tests red (ignore known sql-foundation WAL flake if isolated)\n";
p_gate += "Also confirm remaining P1 if still broken and list them blocking if they are still money lies:\n";
p_gate += "CORE-2/3/4, PAYMOB-1, WEBHOOKS-2/3/4, REDIS-1, RECON-1/2/3, MONEY-1, PERF-1/2.\n";
p_gate += "Non-blocking residual pure P2/P3 allowed if documented.\n";
p_gate += "Return pass (true only if no blocking), blocking[], non_blocking[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:adversarial",
    capability_mode: "all",
    output_schema: gate_schema,
});

let gate_pass = false;
let blocking = [];
let non_blocking = [];
let gate_summary = "gate incomplete";
if gate != () && gate.success && gate.output != () {
    gate_pass = gate.output.pass == true;
    if gate.output.blocking != () { blocking = gate.output.blocking; }
    if gate.output.non_blocking != () { non_blocking = gate.output.non_blocking; }
    gate_summary = gate.output.summary;
    log("Gate: pass=" + gate_pass.to_string() + " " + gate_summary);
} else {
    blocking.push("gate agent failed");
    log("Gate agent failed");
}

// ─── Remediate ───────────────────────────────────────────────────
phase("Remediate");
if (blocking != () && blocking.len() > 0) || typecheck_ok != true || tests_ok != true || invariants_ok != true {
    log("Remediating blocking issues");
    let p_fix = "";
    p_fix += "Fix remaining BLOCKING 2026-08-16 deep-audit issues in " + root + ".\n";
    p_fix += "typecheck_ok=" + typecheck_ok.to_string() + " tests_ok=" + tests_ok.to_string() + " invariants_ok=" + invariants_ok.to_string() + "\n";
    if blocking != () {
        let bi = 0;
        while bi < blocking.len() {
            p_fix += "- blocking: " + blocking[bi] + "\n";
            bi += 1;
        }
    }
    if ver_failures != () {
        let fi = 0;
        while fi < ver_failures.len() {
            p_fix += "- verify failure: " + ver_failures[fi] + "\n";
            fi += 1;
        }
    }
    p_fix += "Priority: WEBHOOKS-1 (P0), CORE-1, STRIPE-1, STRIPE-2, PAYPAL-1, PAYPAL-3, PAYMOB-2,\n";
    p_fix += "then CORE-3/4, WEBHOOKS-2/3/4, PAYMOB-1, REDIS-1, RECON-1/2/3, MONEY-1, PERF-1/2, then typecheck/tests green.\n";
    p_fix += "Read " + audit_doc + " for evidence paths. Fix surgically, re-run typecheck && tests until green. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify " + root + " after remediation. Run bun run typecheck && bun test (core+webhooks+recon+routing+testkit+observability+stores).\n";
    p_ver2 += "Re-check residual blocking invariants from deep-audit-2026-08-16 (WEBHOOKS-1, CORE-1, STRIPE-1/2, PAYPAL-1/3, PAYMOB-2).\n";
    p_ver2 += "Return typecheck_ok, tests_ok, invariants_ok, failures, commands_run, summary, ok.\n";
    let ver2 = agent(p_ver2, #{
        label: "verify:post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if ver2 != () && ver2.success && ver2.output != () {
        typecheck_ok = ver2.output.typecheck_ok;
        tests_ok = ver2.output.tests_ok;
        invariants_ok = ver2.output.invariants_ok;
        if ver2.output.failures != () { ver_failures = ver2.output.failures; }
        log("Post-remediate verify: " + ver2.output.summary);
    }

    let p_gate2 = "";
    p_gate2 += "Quick re-gate of " + root + " after remediation. Read code for remaining residual blocking IDs only from deep-audit-2026-08-16.\n";
    p_gate2 += "Return pass, blocking, non_blocking, summary.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        if gate2.output.blocking != () { blocking = gate2.output.blocking; } else { blocking = []; }
        if gate2.output.non_blocking != () { non_blocking = gate2.output.non_blocking; }
        gate_summary = gate2.output.summary;
    }
    if rem != () && rem.success && rem.output != () {
        log("Remediate: " + rem.output.summary);
    }
} else {
    log("No remediation needed");
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
let final_pass = gate_pass == true && typecheck_ok == true && tests_ok == true && invariants_ok == true;

let p_rep = "";
p_rep += "Write fix result report to " + root + "/docs/audits/deep-audit-fix-result-2026-08-16.md\n";
p_rep += "Include: final_pass, typecheck_ok, tests_ok, invariants_ok, gate_pass, implement ok/fail counts,\n";
p_rep += "blocking list, non_blocking residual, summary of what was fixed vs remaining, pointer to original audit " + audit_doc + ".\n";
p_rep += "final_pass=" + final_pass.to_string() + "\n";
p_rep += "typecheck_ok=" + typecheck_ok.to_string() + " tests_ok=" + tests_ok.to_string() + " invariants_ok=" + invariants_ok.to_string() + "\n";
p_rep += "gate_pass=" + gate_pass.to_string() + " gate_summary=" + gate_summary + "\n";
p_rep += "implement ok/fail=" + impl_ok_count.to_string() + "/" + impl_fail_count.to_string() + "\n";
p_rep += "blocking:\n";
if blocking != () {
    let bj = 0;
    while bj < blocking.len() {
        p_rep += "- " + blocking[bj] + "\n";
        bj += 1;
    }
}
p_rep += "non_blocking:\n";
if non_blocking != () {
    let nj = 0;
    while nj < non_blocking.len() {
        p_rep += "- " + non_blocking[nj] + "\n";
        nj += 1;
    }
}
p_rep += "Verify with greps that residual P0/P1 code paths improved. Do not invent fixes not in tree.\n";
p_rep += "Return {ok, report_path, summary}.\n";

let report_agent = agent(p_rep, #{
    label: "report:write-result",
    capability_mode: "read-write",
    output_schema: report_schema,
});
if report_agent != () && report_agent.success && report_agent.output != () {
    log("Report: " + report_agent.output.report_path + " — " + report_agent.output.summary);
}

log("paykernel-audit-fix-gate complete final_pass=" + final_pass.to_string());

complete(#{
    final_pass: final_pass,
    typecheck_ok: typecheck_ok,
    tests_ok: tests_ok,
    invariants_ok: invariants_ok,
    gate_pass: gate_pass,
    implement_ok: impl_ok_count,
    implement_fail: impl_fail_count,
    gate_summary: gate_summary,
});
