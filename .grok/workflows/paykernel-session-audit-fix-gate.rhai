let meta = #{
    name: "paykernel-session-audit-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every 2026-08-16 session-audit leftover",
    phases: [
        #{ title: "Critic", detail: "reconfirm every session-audit ID against current code" },
        #{ title: "Fix", detail: "parallel non-overlapping streams for residual findings" },
        #{ title: "Integrate", detail: "typecheck, tests, cross-stream consistency" },
        #{ title: "Verify", detail: "typecheck + tests + money-fence invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "fix remaining blockers if any" },
        #{ title: "Report", detail: "write fix-result under docs/audits" },
    ],
    when_to_use: "After the 2026-08-16 session audit leftover report; fix every residual ID",
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

let audit_doc = root + "/docs/audits/session-audit-2026-08-16.md";

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: reconfirming session-audit leftovers in " + root);

let p_critic = "";
p_critic += "Recheck findings from " + audit_doc + " against CURRENT source at " + root + ".\n";
p_critic += "READ-ONLY. Use read_file and grep. For each ID: STILL PRESENT or ALREADY FIXED with file:line.\n";
p_critic += "Do not edit files. Do not commit. Do not trust the audit doc alone — re-read the cited functions.\n\n";
p_critic += "MUST CHECK BLOCKING:\n";
p_critic += "PAYMOB-FENCE-1: reserveStoredIdempotencyRecord deletes expired expiresAt including unknown/in_progress\n";
p_critic += "PAYMOB-FENCE-2: caller abort after mutating POST is PaymentAbortedError and executeIdempotent deletes fence\n";
p_critic += "PAYMOB-FENCE-3: legacy requireNumber/requireString on HTTP 200 missing id/token is GatewayApiError (releases fence)\n";
p_critic += "PAYPAL-IDEM-1: getRequestId empty string skips PayPal-Request-Id\n";
p_critic += "PAYPAL-DW-1: PAYMENT.CAPTURE.REFUNDED still dual-writes refund.completed while status is partially_refunded\n";
p_critic += "WEBHOOKS-403: parse InvalidWebhookError (status 403) classified permanent in processWithVerifier\n\n";
p_critic += "MUST CHECK OTHER P1:\n";
p_critic += "STRIPE-CKO-1 checkout.session.completed/async_payment_succeeded ignore refunds\n";
p_critic += "STRIPE-CHG-1 succeeded PI refunds ignore charges.data[0] when latest_charge omitted\n";
p_critic += "CORE-INF-1 infer success:false + paid/authorized/partial/refunded -> failed\n";
p_critic += "CORE-INF-2 inferRefund success:false + completed -> failed\n";
p_critic += "CORE-HW-1 handleWebhook skips demote when isPaymentEvent passes\n";
p_critic += "CORE-6-EXT coerceStableSucceeded misses authorized/approved/partially_captured\n";
p_critic += "PAYPAL-ID-1 webhook gatewayPaymentId can be the refunded capture\n";
p_critic += "PAYMOB-TOCTOU store without reserve is get-then-set\n";
p_critic += "RECON-LEASE-1 recon fail/complete require unexpired lease; hang livelocks\n";
p_critic += "WH-LIST-FAIL listRetryable wipes token before post-expiry fail\n";
p_critic += "MOYASAR-CAP-0 paid + captured:0 stays paid\n";
p_critic += "PAYMOB-AUTH-REDIR AUTH redirect dual-writes payment.authorized\n\n";
p_critic += "Note P2 if still present: MOYASAR-3 SQL-UPD-1 PERF-3/4/5/6/7 REDIS-CLEAN-1.\n";
p_critic += "Do NOT re-open closed first-pass IDs (WEBHOOKS-1 inbox, CORE-1 pending infer, STRIPE-1/2 original, PAYPAL-1 domain, PAYPAL-3, PAYMOB-2 Intention) unless the original lie is still in source.\n";
p_critic += "Return confirmed[], already_fixed[], summary. Each confirmed entry is ID — one-line evidence.\n";

let critic = agent(p_critic, #{
    label: "critic:reconfirm",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
if critic != () && critic.success && critic.output != () && critic.output.summary != () {
    log("Critic: " + critic.output.summary);
}

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Fixing session-audit leftovers in parallel streams");

let common = "";
common += "Repo root: " + root + "\n";
common += "Audit source of truth: " + audit_doc + " — read YOUR IDs before editing.\n";
common += "Package: PayKernel monorepo (Bun + TypeScript). Do NOT commit. Do NOT push.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; add/flip unit tests that lock the lie;\n";
common += "re-read changed regions; prefer existing PaymentStatus values (partially_captured, partially_refunded,\n";
common += "refund_pending, refund_failed, refund_completed, setup_completed, paid, pending, processing, authorized);\n";
common += "fail-closed on incomplete money; never convert uncertain mutation outcomes into a retryable failure that clears a fence;\n";
common += "ALWAYS publish currency together with major-unit amount fields;\n";
common += "Run bun test on touched test files when possible. Skip items critic proves already fixed.\n";
common += "OWN FILES ONLY — do not edit other streams' files.\n";
common += "Return JSON {ok, files_changed, summary, notes, fixed_ids}.\n";

// A — Stripe
let p_a = "";
p_a += common;
p_a += "STREAM A — STRIPE. OWN:\n";
p_a += "- " + root + "/packages/core/src/gateways/stripe/**\n";
p_a += "- " + root + "/packages/core/docs/stripe.md\n";
p_a += "FIX:\n";
p_a += "STRIPE-CKO-1: checkout.session.completed with payment_status paid and checkout.session.async_payment_succeeded\n";
p_a += "  must not invent paid / payment.succeeded after refunds when the hydrated session/PI/charge shows refunds.\n";
p_a += "  Prefer: if expanded payment_intent/latest_charge/charges show amount_refunded>0 or refunded:true,\n";
p_a += "  map refunded/partially_refunded (same captured-base rule as PI.succeeded) and rematch dual-write to refund.completed\n";
p_a += "  (not payment.succeeded). If refunds are unobservable on a thin/hydrated current session (no charge snapshot),\n";
p_a += "  fail-closed to processing (do not claim paid after documented thin-event hydration).\n";
p_a += "  Evidence: stripe.gateway.ts checkout.session.completed ~2243-2288; stripe.md hydrate note ~262.\n";
p_a += "STRIPE-CHG-1: stripeSucceededIntentRefundStatus / succeededPaymentIntentWebhookStatus must also read\n";
p_a += "  charges.data[0].amount_refunded / refunded when latest_charge is omitted (not only when it is an unexpanded id).\n";
p_a += "  Unexpanded latest_charge id stays processing. Evidence: stripeSucceededIntentRefundStatus ~869-896;\n";
p_a += "  resolveStripeCapturedMinor already reads charges.data for captured amount ~450-476.\n";
p_a += "Add tests: hydrated checkout.session.completed after refund is not paid/payment.succeeded;\n";
p_a += "  PI.succeeded with omitted latest_charge + charges.data[0].amount_refunded is not paid.\n";

// B — PayPal
let p_b = "";
p_b += common;
p_b += "STREAM B — PAYPAL. OWN:\n";
p_b += "- " + root + "/packages/core/src/gateways/paypal/**\n";
p_b += "- " + root + "/packages/core/docs/paypal.md\n";
p_b += "Do NOT edit webhook-event-map.ts (stream G). Rematch dual-write inside paypal.gateway.ts after attach,\n";
p_b += "the same way demoteIncompleteRefundWebhookDualWrite / demotePartialCaptureWebhookDualWrite already work.\n";
p_b += "FIX:\n";
p_b += "PAYPAL-IDEM-1: getRequestId must trim; empty/whitespace must generate a UUID (Stripe resolveStripeIdempotencyKey).\n";
p_b += "  createJsonHeaders must always send PayPal-Request-Id for mutations that call getRequestId.\n";
p_b += "  Evidence: paypal.gateway.ts ~1885-1914.\n";
p_b += "PAYPAL-DW-1: After attachPaymentEvent, if event.type is PAYMENT.CAPTURE.REFUNDED and status is\n";
p_b += "  partially_refunded (refund-shaped / incomplete capture settlement), do NOT leave stableType/event.type\n";
p_b += "  as refund.completed. Demote to refund.pending (same family as refund_completed demote).\n";
p_b += "  Evidence: mapWebhookStatus ~2921-2937; PAYPAL_EVENT_TYPE_MAP refund.completed; demote ~3329-3334\n";
p_b += "  only matches status refund_completed.\n";
p_b += "PAYPAL-ID-1: when building webhook gatewayPaymentId, if sibling captures exist, prefer\n";
p_b += "  selectSingleRefundableCaptureId (the still-held capture) over last/related_ids.capture_id.\n";
p_b += "  If more than one refundable, keep order id (already done). If exactly one refundable, use that id.\n";
p_b += "  Evidence: ~1276-1283 vs selectSingleRefundableCaptureId ~3168-3175; extractWebhookCaptureId ~2812-2818.\n";
p_b += "Add tests: empty idempotencyKey still sends Request-Id; CAPTURE.REFUNDED refund-resource COMPLETED\n";
p_b += "  is not type-only refund.completed; multi-capture partial refund webhook id is the held capture or order.\n";

// C — Paymob
let p_c = "";
p_c += common;
p_c += "STREAM C — PAYMOB. OWN:\n";
p_c += "- " + root + "/packages/core/src/gateways/paymob/**\n";
p_c += "- " + root + "/packages/core/docs/paymob.md\n";
p_c += "Do NOT edit webhook-event-map.ts (stream G owns PAYMOB-AUTH-REDIR map). You MAY fix paymob.md comments.\n";
p_c += "FIX:\n";
p_c += "PAYMOB-FENCE-1: reserveStoredIdempotencyRecord / getStoredIdempotencyRecord must NEVER delete\n";
p_c += "  status unknown or in_progress because expiresAt passed. Only completed replay cache may expire.\n";
p_c += "  Expired in_progress must be treated as unknown (refuse retry), not deleted-and-re-reserved.\n";
p_c += "  Evidence: paymob.gateway.ts ~3068-3100; unknown write with expiresAt ~3007-3012;\n";
p_c += "  in-memory prune correctly keeps unknown/in_progress ~3158-3162.\n";
p_c += "PAYMOB-FENCE-2: caller abort after a mutating POST must keep the fence (indeterminate), matching timeout.\n";
p_c += "  fetchPaymobMutation currently only wraps NetworkError. PaymentAbortedError after POST/body-read is uncertain.\n";
p_c += "  Treat abort on mutation fetch as PaymobIndeterminateNetworkError (or isPaymobIndeterminateError).\n";
p_c += "  Evidence: fetchPaymob ~2812-2887; abort.ts ~219-223; executeIdempotent catch deletes non-indeterminate ~2997-3023.\n";
p_c += "PAYMOB-FENCE-3: legacy Egypt create HTTP 200 missing order id / payment token must throw\n";
p_c += "  PaymobIndeterminateResponseError (requireMutationString / requireMutationNumber), not GatewayApiError.\n";
p_c += "  Evidence: ~678-722; requireString/requireNumber ~3212-3226.\n";
p_c += "PAYMOB-TOCTOU: if idempotencyStore is set but lacks reserve(), throw InvalidRequestError on mutations\n";
p_c += "  (Moyasar parity). Do not fall through to get-then-set. Construction warn may stay as extra signal.\n";
p_c += "  Evidence: ~3077-3083 vs moyasar ~373-379.\n";
p_c += "Add tests: expired unknown fence still refuses same-key refund; abort after Intention/refund POST keeps fence;\n";
p_c += "  legacy 200 missing token keeps fence; store without reserve() throws.\n";

// D — Moyasar
let p_d = "";
p_d += common;
p_d += "STREAM D — MOYASAR. OWN:\n";
p_d += "- " + root + "/packages/core/src/gateways/moyasar/**\n";
p_d += "- " + root + "/packages/core/docs/moyasar.md\n";
p_d += "- " + root + "/packages/core/src/types/moyasar-source.types.ts\n";
p_d += "- " + root + "/packages/core/src/types/payment.types.ts ONLY the moyasarSource JSDoc (MOYASAR-3)\n";
p_d += "FIX:\n";
p_d += "MOYASAR-CAP-0: paid + captured===0 (finite) must not stay paid / payment.succeeded.\n";
p_d += "  Demote like missing captured (processing / incomplete). Do not publish full amount as settled captured.\n";
p_d += "  Evidence: moyasar.gateway.ts ~1341-1348, ~1793-1799. Comment already says finite 0 is only for non-paid paths.\n";
p_d += "MOYASAR-3: stop advertising raw creditcard on backend create types/JSDoc.\n";
p_d += "  CreditCardSource may remain as a documented Moyasar.js / PCI type but CreatePaymentParams.moyasarSource\n";
p_d += "  JSDoc must not say Supports: creditcard. Align moyasar.md.\n";
p_d += "Add tests: paid + captured 0 is not isPaidOutcome / not payment.succeeded.\n";

// E — Webhooks + client
let p_e = "";
p_e += common;
p_e += "STREAM E — WEBHOOKS engine + client handleWebhook. OWN:\n";
p_e += "- " + root + "/packages/webhooks/src/**\n";
p_e += "- " + root + "/packages/webhooks/docs/**\n";
p_e += "- " + root + "/packages/webhooks/README.md\n";
p_e += "- " + root + "/packages/core/src/client.ts\n";
p_e += "- " + root + "/packages/core/src/types/payment-event.ts if CORE-HW-1 needs a tighter guard\n";
p_e += "- " + root + "/packages/core/docs/webhooks.md\n";
p_e += "FIX:\n";
p_e += "WEBHOOKS-403: isPermanentNonRetryableVerifyError must NOT treat parse-stage InvalidWebhookError as permanent\n";
p_e += "  just because statusCode is 403. isParseStageInvalidWebhookMessage already excludes forgery;\n";
p_e += "  also exclude those (and any InvalidWebhookError whose message is not a verify-failure) from the\n";
p_e += "  permanent 4xx fall-through. processWithVerifier + parseWebhookEvent must stay retryable for\n";
p_e += "  Invalid Paymob transaction webhook payload / Invalid Moyasar webhook payload.\n";
p_e += "  Evidence: errors.ts InvalidWebhookError always 403; engine.ts ~207-261, ~359-362.\n";
p_e += "CORE-HW-1: handleWebhook must still run demoteIncompleteSettledWebhookDualWrite /\n";
p_e += "  demoteIncompleteRefundWebhookDualWrite even when isPaymentEvent passes, OR rematch\n";
p_e += "  payment.succeeded + processing/partially_captured/authorized/approved before returning.\n";
p_e += "  A complete v1 arm must not skip money/status demotes. Evidence: client.ts ~787-796.\n";
p_e += "  Prefer always applying the two demote helpers after verify/parse (idempotent if already rematched).\n";
p_e += "WH-LIST-FAIL: if the engine can fail after expiry, document that a concurrent listRetryable that\n";
p_e += "  already soft-released the token will lease_lost (at-least-once). Prefer engine: on lease_lost from\n";
p_e += "  fail-after-handler, still return handler_failed retryable (already does) and do not complete.\n";
p_e += "  Do not change store SQL here (stream F owns list UPDATE).\n";
p_e += "Add tests: parse InvalidWebhookError with status 403 is retryable not permanent;\n";
p_e += "  handleWebhook rematches payment.succeeded + processing even when event is a full v1 PaymentEvent.\n";

// F — Stores
let p_f = "";
p_f += common;
p_f += "STREAM F — STORES + sql-foundation. OWN:\n";
p_f += "- " + root + "/packages/store-redis/src/**\n";
p_f += "- " + root + "/packages/store-postgres/src/**\n";
p_f += "- " + root + "/packages/store-sqlite/src/**\n";
p_f += "- " + root + "/packages/store-d1/src/**\n";
p_f += "- " + root + "/packages/store-d1/migrations/**\n";
p_f += "- " + root + "/packages/store-turso/src/**\n";
p_f += "- " + root + "/packages/store-durable-objects/src/**\n";
p_f += "- " + root + "/packages/sql-foundation/src/**\n";
p_f += "- " + root + "/packages/sql-foundation/docs/**\n";
p_f += "FIX:\n";
p_f += "RECON-LEASE-1 (store half): recon fail (and markManualReview if needed) must accept a matching lease_token\n";
p_f += "  on status=claimed EVEN AFTER lease_expires_at <= now (webhook WEBHOOKS-2 parity). complete may stay\n";
p_f += "  unexpired-only if that is the documented crash boundary — but fail after hang must record retry/dead-letter.\n";
p_f += "  Apply postgres/sqlite/d1/turso/do/redis recon fail templates consistently.\n";
p_f += "  Evidence: store-postgres reconciliation-store.ts ~254-279 vs sql-foundation webhookFailTemplates ~751-778.\n";
p_f += "WH-LIST-FAIL / SQL-UPD-1: Postgres (and siblings) expired-claim UPDATE must re-check status='claimed'\n";
p_f += "  in the outer WHERE (AND status = 'claimed'), not only in the subquery, so concurrent pollers cannot\n";
p_f += "  double-decrement attempts. Evidence: reconciliation-store.ts ~355-370; webhook-inbox-store.ts ~307-323.\n";
p_f += "PERF-3: add a new sql-foundation migration version that CREATE INDEX IF NOT EXISTS the composite\n";
p_f += "  list/cleanup indexes (do NOT rewrite applied v1). Update store-d1/migrations snapshot to match.\n";
p_f += "PERF-4: if cheap, batch Redis list loads; otherwise leave a comment + test that SCAN is still off the poll path.\n";
p_f += "PERF-5: document DO fan-out cost in adapter docs if no cheaper correct global earliest-N exists. Do not break correctness.\n";
p_f += "REDIS-CLEAN-1: deleteExpired default limit must not be Infinity on a hot operator path — pick a bounded default\n";
p_f += "  (e.g. 1000) matching SQL adapters, allow explicit higher limit.\n";
p_f += "Add tests: recon fail after lease expiry with matching token records pending; UPDATE outer claimed predicate;\n";
p_f += "  migrate() applies a new version for indexes; deleteExpired default is bounded.\n";

// G — Core infer + map
let p_g = "";
p_g += common;
p_g += "STREAM G — CORE infer + webhook-event-map. OWN:\n";
p_g += "- " + root + "/packages/core/src/types/operation-result.ts\n";
p_g += "- " + root + "/packages/core/src/types/webhook-event-map.ts\n";
p_g += "- " + root + "/packages/core/src/types/operation-result.test.ts\n";
p_g += "- " + root + "/packages/core/src/types/payment-event.test.ts if map tests live there\n";
p_g += "- " + root + "/packages/core/docs/operation-results.md\n";
p_g += "Do NOT edit client.ts or payment-event.ts (stream E). Do NOT edit payment.types.ts (stream D).\n";
p_g += "FIX:\n";
p_g += "CORE-INF-1: inferOperationOutcome — success:false (or omitted success) + paid/authorized/partially_captured/\n";
p_g += "  refunded/partially_refunded must be indeterminate, not failed. Same family as P610-INF-2.\n";
p_g += "  Evidence: operation-result.ts ~329-346.\n";
p_g += "CORE-INF-2: inferRefundOperationOutcome — success:false + status completed must be indeterminate, not failed.\n";
p_g += "  Evidence: ~1004-1007 (completed+success already succeeded earlier; the false+completed fallthrough is the hole).\n";
p_g += "CORE-6-EXT: coerceStableSucceededToDomainStatus must also rematch authorized/approved/partially_captured\n";
p_g += "  (and refunded/partially_refunded if type is payment.succeeded) so type-only handlers do not fulfill.\n";
p_g += "  authorized/approved/partial -> payment.processing or payment.authorized as appropriate (partial is processing).\n";
p_g += "  refunded/partially_refunded on a succeeded name -> refund.completed (or processing if you cannot attach refund arm here).\n";
p_g += "  Prefer processing for partial/auth; do not invent refund.completed without a refund entity in this mapper if unsafe.\n";
p_g += "PAYMOB-AUTH-REDIR: mapPaymobEventType redirect + authorized must demote to payment.processing\n";
p_g += "  (include payment.authorized in PAYMOB_FULFILLMENT_READY_STABLE or an adjacent redirect demote set).\n";
p_g += "  Evidence: webhook-event-map.ts ~357-358, ~554-559.\n";
p_g += "Add tests for each infer/map case.\n";

// H — Recon scheduler
let p_h = "";
p_h += common;
p_h += "STREAM H — RECONCILIATION scheduler + ROUTING docs if needed. OWN:\n";
p_h += "- " + root + "/packages/reconciliation/src/**\n";
p_h += "- " + root + "/packages/reconciliation/docs/**\n";
p_h += "- " + root + "/packages/routing/src/**\n";
p_h += "- " + root + "/packages/routing/docs/**\n";
p_h += "Do NOT edit store-* SQL (stream F). You own scheduler policy for hang/lease_lost.\n";
p_h += "FIX:\n";
p_h += "RECON-LEASE-1 (scheduler half): a handler that overruns defaultLeaseMs must not livelock forever.\n";
p_h += "  After F allows fail-after-expiry, processDue should call failAndReschedule (or fail) on hang/throw\n";
p_h += "  so attempts can reach maxAttempts. If fail still lease_lost because listDue already wiped the token,\n";
p_h += "  do not treat that as a free infinite reclaim without budget — document + increment a hang counter\n";
p_h += "  OR rely on F's fail-after-expiry so this path records.\n";
p_h += "  Evidence: scheduler.ts ~482-489; defaultLeaseMs 30s.\n";
p_h += "PERF-7: keep list-then-claim fencing; if cheap, do not oversample beyond the existing 200 cap.\n";
p_h += "Add tests: processDue handler that returns after lease expiry eventually budgets (not infinite leaseLost-only).\n";

// I — Observability leftover / no new money IDs
let p_i = "";
p_i += common;
p_i += "STREAM I — OBSERVABILITY + TESTKIT polish. OWN:\n";
p_i += "- " + root + "/packages/observability/src/**\n";
p_i += "- " + root + "/packages/observability/docs/**\n";
p_i += "- " + root + "/packages/testkit/src/**\n";
p_i += "No new P1 money IDs. If tests exist that lock session-audit lies (checkout paid after refund, infer failed on paid),\n";
p_i += "do not flip production adapters here. Only update testkit if a mock trains checkout-paid-after-refund or\n";
p_i += "success:false+paid as failed. Otherwise return ok with fixed_ids=[] after confirming no lock-in lies.\n";

// J — Docs
let p_j = "";
p_j += common;
p_j += "STREAM J — DOCS audit bookkeeping. OWN:\n";
p_j += "- " + root + "/docs/audits/** only\n";
p_j += "Write " + root + "/docs/audits/session-audit-fix-pass-2026-08-16.md with stream ownership and residual IDs.\n";
p_j += "List blocking: PAYMOB-FENCE-1/2/3, PAYPAL-IDEM-1, PAYPAL-DW-1, WEBHOOKS-403.\n";
p_j += "List other P1: STRIPE-CKO-1, STRIPE-CHG-1, CORE-INF-1/2, CORE-HW-1, CORE-6-EXT, PAYPAL-ID-1,\n";
p_j += "PAYMOB-TOCTOU, RECON-LEASE-1, WH-LIST-FAIL, MOYASAR-CAP-0, PAYMOB-AUTH-REDIR.\n";
p_j += "List P2: MOYASAR-3, SQL-UPD-1, PERF-3/4/5/6/7, REDIS-CLEAN-1.\n";
p_j += "Do NOT edit packages/**.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:stripe", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:paypal", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:paymob", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:moyasar", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:webhooks", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:stores", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:core-infer", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_h, label: "fix:recon", capability_mode: "all", output_schema: implement_schema },
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
            if r.output.summary != () {
                log("OK implement: " + r.output.summary);
            }
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
p_int += "Integrate session-audit-fix-gate streams in " + root + ". Do NOT commit.\n";
p_int += "1) git status / diff — fix any broken TS from parallel streams.\n";
p_int += "2) bun run typecheck across monorepo — fix all errors from our changes.\n";
p_int += "3) bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso until green (known sql-foundation bun:sqlite WAL flake may remain — isolate if needed).\n";
p_int += "4) Cross-check invariants from " + audit_doc + ":\n";
p_int += "   - PAYMOB-FENCE-1: expired unknown fence is not deleted\n";
p_int += "   - PAYMOB-FENCE-2: abort after mutation keeps fence\n";
p_int += "   - PAYMOB-FENCE-3: legacy 200 missing token keeps fence\n";
p_int += "   - PAYPAL-IDEM-1: empty key still sends Request-Id\n";
p_int += "   - PAYPAL-DW-1: CAPTURE.REFUNDED refund-resource is not type-only refund.completed\n";
p_int += "   - WEBHOOKS-403: parse InvalidWebhookError 403 is retryable\n";
p_int += "5) Update " + root + "/docs/audits/session-audit-fix-pass-2026-08-16.md with what landed vs remaining.\n";
p_int += "6) Flip any remaining tests locking the leftover lies. Prefer fail-closed money/fences.\n";
p_int += "Return {ok, files_changed, summary, notes, fixed_ids}.\n";

let int_result = agent(p_int, #{
    label: "integrate:typecheck-test",
    capability_mode: "all",
    output_schema: implement_schema,
});
if int_result == () || !int_result.success || (int_result.output != () && int_result.output.ok != true) {
    log("Integrate reported issues — verify will surface details");
} else if int_result.output != () && int_result.output.summary != () {
    log("Integrate OK: " + int_result.output.summary);
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify session-audit fixes in " + root + " with command evidence and file reads.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso\n";
p_ver += "3) Invariant greps/reads (must hold):\n";
p_ver += "   - PAYMOB-FENCE-1: unknown/in_progress not deleted on expiresAt\n";
p_ver += "   - PAYMOB-FENCE-2: PaymentAbortedError on mutation fetch is indeterminate or fenced\n";
p_ver += "   - PAYMOB-FENCE-3: legacy require after 200 is PaymobIndeterminateResponseError\n";
p_ver += "   - PAYPAL-IDEM-1: empty idempotencyKey generates Request-Id\n";
p_ver += "   - PAYPAL-DW-1: CAPTURE.REFUNDED + partially_refunded not refund.completed dual-write\n";
p_ver += "   - WEBHOOKS-403: 403 parse InvalidWebhookError not permanent\n";
p_ver += "   - STRIPE-CKO-1 / STRIPE-CHG-1 refunds observed or fail-closed\n";
p_ver += "   - CORE-INF-1/2 settled+!success is indeterminate\n";
p_ver += "   - CORE-HW-1 demotes still run; CORE-6-EXT / PAYMOB-AUTH-REDIR rematch\n";
p_ver += "   - RECON-LEASE-1 fail after expiry possible; SQL-UPD-1 outer claimed predicate\n";
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
    if ver.output.typecheck_ok == true { typecheck_ok = true; }
    if ver.output.tests_ok == true { tests_ok = true; }
    if ver.output.invariants_ok == true { invariants_ok = true; }
    if ver.output.failures != () {
        ver_failures = ver.output.failures;
    }
    if ver.output.summary != () {
        log("Verify: " + ver.output.summary);
    }
} else {
    log("Verify agent failed");
    ver_failures.push("verify agent failed or empty");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarially gate PayKernel session-audit-fix-gate in " + root + ".\n";
p_gate += "Skeptical: read actual code with read_file/grep. Do NOT trust implement summaries.\n";
p_gate += "BLOCKING if still broken:\n";
p_gate += "PAYMOB-FENCE-1: expired unknown still deleted and re-reserved\n";
p_gate += "PAYMOB-FENCE-2: caller abort after POST still clears fence\n";
p_gate += "PAYMOB-FENCE-3: legacy 200 missing id/token still GatewayApiError fence release\n";
p_gate += "PAYPAL-IDEM-1: empty key still omits PayPal-Request-Id\n";
p_gate += "PAYPAL-DW-1: CAPTURE.REFUNDED still type-only refund.completed on partial/refund-shaped\n";
p_gate += "WEBHOOKS-403: parse InvalidWebhookError 403 still permanent\n";
p_gate += "Also list as blocking if still money lies: STRIPE-CKO-1, STRIPE-CHG-1, CORE-INF-1/2, CORE-HW-1,\n";
p_gate += "CORE-6-EXT, PAYPAL-ID-1, PAYMOB-TOCTOU, RECON-LEASE-1, MOYASAR-CAP-0, PAYMOB-AUTH-REDIR.\n";
p_gate += "P0: typecheck or tests red (ignore known sql-foundation WAL flake if isolated).\n";
p_gate += "Non-blocking residual PERF-* / MOYASAR-3 / REDIS-CLEAN-1 allowed if documented.\n";
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
    if gate.output.pass == true { gate_pass = true; }
    if gate.output.blocking != () { blocking = gate.output.blocking; }
    if gate.output.non_blocking != () { non_blocking = gate.output.non_blocking; }
    if gate.output.summary != () { gate_summary = gate.output.summary; }
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
    p_fix += "Fix remaining BLOCKING session-audit issues in " + root + ".\n";
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
    p_fix += "Priority: PAYMOB-FENCE-1/2/3, PAYPAL-IDEM-1, PAYPAL-DW-1, WEBHOOKS-403,\n";
    p_fix += "then STRIPE-CKO-1/CHG-1, CORE-INF-1/2, CORE-HW-1, CORE-6-EXT, PAYPAL-ID-1,\n";
    p_fix += "PAYMOB-TOCTOU, RECON-LEASE-1, MOYASAR-CAP-0, PAYMOB-AUTH-REDIR, then typecheck/tests green.\n";
    p_fix += "Read " + audit_doc + " for evidence paths. Fix surgically. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify " + root + " after remediation. Run bun run typecheck && bun test (core+webhooks+recon+routing+testkit+observability+stores).\n";
    p_ver2 += "Re-check blocking invariants from " + audit_doc + " (PAYMOB-FENCE-1/2/3, PAYPAL-IDEM-1, PAYPAL-DW-1, WEBHOOKS-403).\n";
    p_ver2 += "Return typecheck_ok, tests_ok, invariants_ok, failures, commands_run, summary, ok.\n";
    let ver2 = agent(p_ver2, #{
        label: "verify:post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if ver2 != () && ver2.success && ver2.output != () {
        typecheck_ok = false;
        tests_ok = false;
        invariants_ok = false;
        if ver2.output.typecheck_ok == true { typecheck_ok = true; }
        if ver2.output.tests_ok == true { tests_ok = true; }
        if ver2.output.invariants_ok == true { invariants_ok = true; }
        if ver2.output.failures != () { ver_failures = ver2.output.failures; }
        if ver2.output.summary != () { log("Post-remediate verify: " + ver2.output.summary); }
    }

    let p_gate2 = "";
    p_gate2 += "Quick re-gate of " + root + " after remediation. Read code for remaining blocking IDs from " + audit_doc + ".\n";
    p_gate2 += "Return pass, blocking, non_blocking, summary.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = false;
        if gate2.output.pass == true { gate_pass = true; }
        if gate2.output.blocking != () { blocking = gate2.output.blocking; } else { blocking = []; }
        if gate2.output.non_blocking != () { non_blocking = gate2.output.non_blocking; }
        if gate2.output.summary != () { gate_summary = gate2.output.summary; }
    }
    if rem != () && rem.success && rem.output != () && rem.output.summary != () {
        log("Remediate: " + rem.output.summary);
    }
} else {
    log("No remediation needed");
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
let final_pass = gate_pass == true && typecheck_ok == true && tests_ok == true && invariants_ok == true;

let p_rep = "";
p_rep += "Write fix result report to " + root + "/docs/audits/session-audit-fix-result-2026-08-16.md\n";
p_rep += "Include: final_pass, typecheck_ok, tests_ok, invariants_ok, gate_pass, implement ok/fail counts,\n";
p_rep += "blocking list, non_blocking residual, summary of what was fixed vs remaining, pointer to " + audit_doc + ".\n";
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
p_rep += "Verify with greps that residual P1 code paths improved. Do not invent fixes not in tree.\n";
p_rep += "Return {ok, report_path, summary}.\n";

let report_agent = agent(p_rep, #{
    label: "report:write-result",
    capability_mode: "read-write",
    output_schema: report_schema,
});
if report_agent != () && report_agent.success && report_agent.output != () && report_agent.output.summary != () {
    let rp = "";
    if report_agent.output.report_path != () { rp = report_agent.output.report_path; }
    log("Report: " + rp + " — " + report_agent.output.summary);
}

log("paykernel-session-audit-fix-gate complete final_pass=" + final_pass.to_string());

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
