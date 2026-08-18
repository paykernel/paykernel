let meta = #{
    name: "paykernel-leftover-audit-r4-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every 2026-08-16 leftover (round-4) finding",
    phases: [
        #{ title: "Critic", detail: "reconfirm every leftover-audit-r4 ID against current code" },
        #{ title: "Fix", detail: "parallel non-overlapping streams for residual findings" },
        #{ title: "Integrate", detail: "typecheck, tests, cross-stream consistency" },
        #{ title: "Verify", detail: "typecheck + tests + money-fence invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "fix remaining blockers if any" },
        #{ title: "Report", detail: "write fix-result under docs/audits" },
    ],
    when_to_use: "After leftover-audit-r4-2026-08-16 SHIP_BLOCKED; fix every residual NEW-* ID from that pass",
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

let audit_doc = root + "/docs/audits/leftover-audit-r4-2026-08-16.md";

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: reconfirming leftover-audit-r4 findings in " + root);

let p_critic = "";
p_critic += "Recheck findings from " + audit_doc + " against CURRENT source at " + root + ".\n";
p_critic += "READ-ONLY. Use read_file and grep. For each ID: STILL PRESENT or ALREADY FIXED with file:line.\n";
p_critic += "Do not edit files. Do not commit. Do not trust the audit doc alone — re-read the cited functions.\n\n";
p_critic += "MUST CHECK BLOCKING:\n";
p_critic += "NEW-MOYASAR-REFUND-ID: refundPayment never calls assertObservedPaymentId; HTTP 200 {} is pending + fence completed.\n";
p_critic += "NEW-PAYMOB-4XX: throwPaymobApiError unknownOnServerError only status>=500 or 429; 408/409/425 after POST deletes fence; Payment Keys 4xx after Orders 200 releases create fence.\n";
p_critic += "NEW-PAYPAL-3: PAYMENT.CAPTURE.COMPLETED / capture GET / order map treat missing final_capture as paid.\n\n";
p_critic += "MUST CHECK OTHER P1:\n";
p_critic += "NEW-WEBHOOKS-2: processed Paymob TRANSACTION inbox key is still obj.id; later same-id snapshot already_completed.\n\n";
p_critic += "Note P2 if still present: NEW-STRIPE-VOID-1 NEW-STRIPE-INV-1 NEW-STRIPE-CKO-URL NEW-STRIPE-SETUP-1\n";
p_critic += "NEW-CORE-8 NEW-CORE-9 NEW-CORE-10 NEW-MONEY-3 NEW-PAYPAL-4/5/6 NEW-MOYASAR-4XX NEW-WH-1\n";
p_critic += "NEW-ROUTE-1 NEW-STORE-2/3 NEW-TESTKIT-6/7/8 NEW-OBS-2 NEW-PKG-2 NEW-SQL-1 NEW-PERF-8.\n";
p_critic += "Do NOT re-open closed first/session/leftover-r3 IDs unless the original lie is still in source.\n";
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
log("Fixing leftover-audit-r4 findings in parallel streams");

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
p_a += "Do NOT edit abort.ts, client.ts, webhook-event-map.ts, operation-result.ts, logger.ts.\n";
p_a += "FIX:\n";
p_a += "NEW-STRIPE-VOID-1: voidPayment must requireStripeMutationStatus like create/capture/refund.\n";
p_a += "  Missing status after HTTP 200 is NetworkError afterProviderSubmit (indeterminate), not mapStatus(undefined)=failed.\n";
p_a += "  Keep forceOutcome succeeded only when status is canceled/cancelled (intentional void).\n";
p_a += "  Evidence: stripe.gateway.ts voidPayment ~1855-1894; requireStripeMutationStatus ~930-938.\n";
p_a += "NEW-STRIPE-INV-1: stripeInvoiceStatus must not always return paid for invoice.paid / payment_succeeded.\n";
p_a += "  If object.status is void/uncollectible, map cancelled/failed. If post_payment_credit_notes_amount is a finite >0,\n";
p_a += "  do not claim full paid (processing). stripeInvoiceAmount for paid events must prefer amount_paid only;\n";
p_a += "  never fall through to amount_due as collected. Evidence: ~518-555.\n";
p_a += "NEW-STRIPE-CKO-URL: createCheckoutSession may keep success after requireStripeMutationId, but omit url when\n";
p_a += "  response.url is null/empty. Document in stripe.md that url can be absent. Evidence: ~2252-2263.\n";
p_a += "NEW-STRIPE-SETUP-1: parseWebhookEvent switch must map setup_intent.succeeded to status setup_completed\n";
p_a += "  (catalog already maps dual-write). Default pending for other setup_intent.* is ok. Evidence: ~2696-2708.\n";
p_a += "Add tests: void 200 {id} without status is not declined; invoice.paid + credit notes not full paid;\n";
p_a += "  invoice.paid amount does not use amount_due; setup_intent.succeeded status is setup_completed;\n";
p_a += "  createCheckoutSession null url is not a string url.\n";

// B — PayPal
let p_b = "";
p_b += common;
p_b += "STREAM B — PAYPAL. OWN:\n";
p_b += "- " + root + "/packages/core/src/gateways/paypal/**\n";
p_b += "- " + root + "/packages/core/docs/paypal.md\n";
p_b += "Do NOT edit abort.ts or webhook-event-map.ts.\n";
p_b += "FIX:\n";
p_b += "NEW-PAYPAL-3 (BLOCKING): mapWebhookStatus PAYMENT.CAPTURE.COMPLETED, capture GET, and order capture mapping\n";
p_b += "  must treat missing/undefined final_capture as NOT paid. Use partially_captured (or processing) unless\n";
p_b += "  final_capture === true. PayPal API default is false. Update paypal.md table (currently !== false).\n";
p_b += "  Evidence: paypal.gateway.ts ~3015-3021, ~1484-1485, ~3108-3109, ~3376-3380; paypal.md ~331, ~351.\n";
p_b += "NEW-PAYPAL-4: remaining-held rewrite must run for CAPTURE.REFUNDED / REVERSED even when resource status\n";
p_b += "  is COMPLETED (this-op / order-shaped). Do not publish full face as event.amount when remaining-held is known.\n";
p_b += "  Evidence: extractSingleCaptureWebhookHeldAmount ~2746-2752.\n";
p_b += "NEW-PAYPAL-5: getAuthorizationResource must not copy related_ids.capture_id as the sole refund target\n";
p_b += "  without a sibling check. If siblings cannot be proven, omit captureId (auth id is not refundable).\n";
p_b += "  Evidence: ~1555-1557 vs webhook sibling select ~1299-1308.\n";
p_b += "NEW-PAYPAL-6: isAggregateCapturePartial — missing/unparsable order/auth total must NOT return false\n";
p_b += "  in a way that upgrades COMPLETED to paid. Missing total → treat as incomplete (not paid).\n";
p_b += "  Evidence: ~3244-3270.\n";
p_b += "Add tests: CAPTURE.COMPLETED without final_capture is not paid / not isPaidOutcome;\n";
p_b += "  capture GET missing final_capture is not paid; ORDER.COMPLETED without totals is not paid.\n";

// C — Paymob
let p_c = "";
p_c += common;
p_c += "STREAM C — PAYMOB. OWN:\n";
p_c += "- " + root + "/packages/core/src/gateways/paymob/**\n";
p_c += "- " + root + "/packages/core/docs/paymob.md\n";
p_c += "Do NOT edit webhook-event-map.ts, abort.ts, event-key.ts, or client.ts.\n";
p_c += "FIX:\n";
p_c += "NEW-PAYMOB-4XX (BLOCKING): throwPaymobApiError with unknownOnServerError must treat 408, 409, 425\n";
p_c += "  like 429 (PaymobIndeterminateGatewayError). shouldRetainPaymobMutationFence must keep those statuses\n";
p_c += "  (and RateLimitError) so executeIdempotent does not delete the key.\n";
p_c += "  Intention / Orders / Payment Keys / capture / refund / void already pass unknownOnServerError:true.\n";
p_c += "  After Orders HTTP 200 + id, Payment Keys 4xx must KEEP the create fence (same key cannot mint a second order).\n";
p_c += "  Evidence: paymob.gateway.ts ~2751-2761, ~351-359, ~3072-3075, ~670-742.\n";
p_c += "Add tests: refund POST HTTP 408 keeps fence (second same-key call does not POST again);\n";
p_c += "  legacy create Orders 200 then Payment Keys 408 keeps fence / does not create a second order.\n";

// D — Moyasar
let p_d = "";
p_d += common;
p_d += "STREAM D — MOYASAR. OWN:\n";
p_d += "- " + root + "/packages/core/src/gateways/moyasar/**\n";
p_d += "- " + root + "/packages/core/docs/moyasar.md\n";
p_d += "Do NOT edit abort.ts or client.ts.\n";
p_d += "FIX:\n";
p_d += "NEW-MOYASAR-REFUND-ID (BLOCKING): refundPayment must call assertObservedPaymentId(payment) before mapping.\n";
p_d += "  HTTP 200 {} / missing id throws NetworkError afterProviderSubmit. runIdempotentMutation then keeps\n";
p_d += "  the fence unknown (isMoyasarDefiniteMutationFailure is false for 2xx NetworkError).\n";
p_d += "  Do NOT persist completed pending with undefined gatewayRefundId.\n";
p_d += "  Evidence: moyasar.gateway.ts ~899-960 vs assertObservedPaymentId ~1577-1595; runIdempotentMutation ~415-428.\n";
p_d += "NEW-MOYASAR-4XX: isMoyasarDefiniteMutationFailure must NOT treat 408/409/425 as definite reject.\n";
p_d += "  Keep fence unknown (same class as 429). Evidence: ~124-133.\n";
p_d += "Add tests: refund HTTP 200 {} is indeterminate / not completed fence; refund 408 keeps fence.\n";

// E — Webhooks + client rematch
let p_e = "";
p_e += common;
p_e += "STREAM E — WEBHOOKS engine + client handleWebhook rematch. OWN:\n";
p_e += "- " + root + "/packages/webhooks/src/**\n";
p_e += "- " + root + "/packages/webhooks/docs/**\n";
p_e += "- " + root + "/packages/webhooks/README.md\n";
p_e += "- " + root + "/packages/core/src/client.ts\n";
p_e += "- " + root + "/packages/core/docs/webhooks.md\n";
p_e += "Do NOT edit webhook-event-map.ts (stream G). Do NOT edit paymob.gateway.ts (stream C).\n";
p_e += "FIX:\n";
p_e += "NEW-CORE-8 (client rematch only): rematchSucceededWebhookDualWriteAgainstDomainStatus must also rematch\n";
p_e += "  capture.completed and refund.completed when envelope status is open money / failed / cancelled.\n";
p_e += "  capture.completed + partially_captured/processing → payment.processing.\n";
p_e += "  refund.completed + processing/pending/failed → refund.pending or payment.processing (do not keep completed).\n";
p_e += "  Evidence: client.ts ~154-254.\n";
p_e += "NEW-WEBHOOKS-2: qualifyPaymobProviderEventId / deriveWebhookEventKey — for processed TRANSACTION\n";
p_e += "  (not redirect), include domain status in the inbox key when available so a later same-id void/refund\n";
p_e += "  snapshot is not already_completed. Example: paymob:TRANSACTION:{txnId}:{status}. Redirect stays\n";
p_e += "  TRANSACTION_RESPONSE:{txnId}. Update event-key.ts comments, README, inbox-engine.md.\n";
p_e += "  Engine must pass envelope status into deriveWebhookEventKey if needed — add an optional status arg\n";
p_e += "  or read event.status from extractInboxNotificationClass sibling. Do not change paymob event.id.\n";
p_e += "NEW-WH-1: extractInboxNotificationClass must NOT fall through to remapped domain type\n";
p_e += "  (payment.succeeded). Only provider.eventType or known native classes (TRANSACTION, TRANSACTION_RESPONSE).\n";
p_e += "  Evidence: engine.ts ~680-697.\n";
p_e += "NEW-STORE-3: webhooks memory-store complete/renew must not wipe expired lease before token check.\n";
p_e += "  Match durable: token match can complete after expiry, or fail closed without restore-then-lose.\n";
p_e += "  Evidence: packages/webhooks/src/memory-store.ts complete/renew.\n";
p_e += "Add tests: rematch capture.completed + partially_captured is not type-only completed;\n";
p_e += "  Paymob processed keys with different status are distinct; extractInboxNotificationClass ignores payment.succeeded;\n";
p_e += "  memory complete after expiry with valid token records or does not wipe-then-lease_lost.\n";

// F — Stores
let p_f = "";
p_f += common;
p_f += "STREAM F — STORES deleteExpired default + recon memory. OWN:\n";
p_f += "- " + root + "/packages/store-postgres/src/**\n";
p_f += "- " + root + "/packages/store-sqlite/src/**\n";
p_f += "- " + root + "/packages/store-d1/src/**\n";
p_f += "- " + root + "/packages/store-turso/src/**\n";
p_f += "- " + root + "/packages/store-durable-objects/src/stores/**\n";
p_f += "- " + root + "/packages/reconciliation/src/memory-store.ts\n";
p_f += "- " + root + "/packages/reconciliation/src/memory-store.test.ts if present\n";
p_f += "Do NOT edit webhooks/src (stream E). Do NOT edit sql-foundation (stream J).\n";
p_f += "FIX:\n";
p_f += "NEW-PERF-8: SQL deleteExpired without input.limit must default to a finite cap (1000, like Redis),\n";
p_f += "  not unbounded DELETE. Apply webhook-inbox and reconciliation stores in postgres/sqlite/d1/turso/DO.\n";
p_f += "  Evidence: store-postgres reconciliation-store.ts ~357-383 (and siblings).\n";
p_f += "NEW-STORE-2: recon memory maxEntries must not evict an active claimed lease. Skip live claimed like\n";
p_f += "  webhook memory, or refuse insert when full of live leases.\n";
p_f += "  Evidence: packages/reconciliation/src/memory-store.ts ~120-128.\n";
p_f += "Add a unit assertion that default deleteExpired uses LIMIT; memory eviction skips claimed.\n";

// G — Core apply + map + money
let p_g = "";
p_g += common;
p_g += "STREAM G — CORE operation-result + webhook-event-map + payment-event money. OWN:\n";
p_g += "- " + root + "/packages/core/src/types/operation-result.ts\n";
p_g += "- " + root + "/packages/core/src/types/operation-result.test.ts\n";
p_g += "- " + root + "/packages/core/src/types/webhook-event-map.ts\n";
p_g += "- " + root + "/packages/core/src/types/payment-event.ts\n";
p_g += "- " + root + "/packages/core/src/types/payment-event.test.ts\n";
p_g += "- " + root + "/packages/core/docs/operation-results.md if needed\n";
p_g += "Do NOT edit client.ts (stream E). Do NOT edit stripe/paypal/paymob/moyasar gateways.\n";
p_g += "FIX:\n";
p_g += "NEW-CORE-8 (mapper): coerceStableSucceededToDomainStatus / mapMoyasarEventType must rematch\n";
p_g += "  capture.completed when context.status is partially_captured / processing → payment.processing.\n";
p_g += "  Flip payment-event.test.ts that locks payment_captured + partially_captured → capture.completed.\n";
p_g += "  Evidence: webhook-event-map.ts ~257-282, ~590-620; payment-event.test.ts ~293-307.\n";
p_g += "NEW-CORE-9: inferOperationOutcome success:false + refund_completed / refund_pending / reversed\n";
p_g += "  must be indeterminate (not failed). coerceRefundOutcomeToGatewayStatus: failed + completed → succeeded.\n";
p_g += "  Evidence: operation-result.ts ~376-388, ~1076-1090.\n";
p_g += "NEW-CORE-10: coercePaymentOutcomeToGatewayStatus — requires_action + status failed → declined (not success:true).\n";
p_g += "  Evidence: ~472-486.\n";
p_g += "NEW-MONEY-3: moneyFieldsFromWebhook / paymentFromWebhookEvent copy amount only when Number.isFinite.\n";
p_g += "  Evidence: payment-event.ts ~865-880.\n";
p_g += "Add tests for each.\n";

// H — Routing
let p_h = "";
p_h += common;
p_h += "STREAM H — ROUTING complementary-partition honesty. OWN:\n";
p_h += "- " + root + "/packages/routing/src/**\n";
p_h += "- " + root + "/packages/routing/docs/**\n";
p_h += "Do NOT edit store-* or webhooks.\n";
p_h += "FIX:\n";
p_h += "NEW-ROUTE-1: When no candidates remain, do not use unconstrained select-time fallback if at least one\n";
p_h += "  rule matches all non-currency (or non-country / non-method) criteria but fails that partition — same\n";
p_h += "  honesty as hasAmountRangeOnlyReject. Complementary USD→stripe + EUR→adyen with exclude adyen + EUR input\n";
p_h += "  must throw NoRouteMatchError, not fallback to stripe.\n";
p_h += "  trySelectFallbackGateway must not rewrite that NoRouteMatchError to no_alternate_gateway;\n";
p_h += "  preserve the honesty reason (or a dedicated reason string).\n";
p_h += "  Evidence: router.ts ~116-147; fallback.ts ~584-594.\n";
p_h += "Add a test: complementary currency rules + exclude + fallback does not silently pick fallback.\n";

// I — Testkit + obs + logger
let p_i = "";
p_i += common;
p_i += "STREAM I — TESTKIT + OBSERVABILITY + core logger. OWN:\n";
p_i += "- " + root + "/packages/testkit/src/**\n";
p_i += "- " + root + "/packages/observability/src/**\n";
p_i += "- " + root + "/packages/core/src/utils/logger.ts\n";
p_i += "- " + root + "/packages/core/src/utils/utils.test.ts if logger tests live there\n";
p_i += "Do NOT edit gateways or operation-result.ts.\n";
p_i += "FIX:\n";
p_i += "NEW-TESTKIT-6: defaultOutcome / scripted outcome succeeded must not force status paid when\n";
p_i += "  create params.capture===false and authorization capability is on — use authorized, capturedAmount 0.\n";
p_i += "  Evidence: mock-gateway.ts ~1031-1035, ~1402-1403.\n";
p_i += "NEW-TESTKIT-7: createPaymentIdentityFields must include stripeCustomerId, paymobIntegrationId,\n";
p_i += "  paymobPaymentMethods. Evidence: ~157-181.\n";
p_i += "NEW-TESTKIT-8: webhook helpers must not default status paid when type is payment_failed / failed.\n";
p_i += "  Default status from type. Evidence: webhook-helpers.ts ~126-131.\n";
p_i += "NEW-OBS-2: SECRET_SHAPED_STRING / redact must match Stripe PI client secrets (pi_..._secret_...)\n";
p_i += "  on string leaves AND on the logger message argument (sanitize message, not only context).\n";
p_i += "  Evidence: packages/core/src/utils/logger.ts ~114-115, ~273-279.\n";
p_i += "Add tests for each.\n";

// J — Docs + sql-foundation honesty
let p_j = "";
p_j += common;
p_j += "STREAM J — DOCS + sql-foundation honesty. OWN:\n";
p_j += "- " + root + "/docs/audits/**\n";
p_j += "- " + root + "/packages/sql-foundation/src/index.ts\n";
p_j += "- " + root + "/packages/sql-foundation/src/reference/**\n";
p_j += "- " + root + "/packages/sql-foundation/docs/**\n";
p_j += "- " + root + "/packages/sql-foundation/src/claims/templates.ts (comment/docs only if needed)\n";
p_j += "- " + root + "/packages/store-contracts/src/contracts.ts (NEW-SQL-1 comment/JSDoc only)\n";
p_j += "Do NOT edit store adapter implementations (stream F).\n";
p_j += "FIX:\n";
p_j += "NEW-PKG-2: createMemoryRelationalStore.migrate() must not mark logical tables present unless\n";
p_j += "  statements actually ran. createExecutor always {ok:true} is fine for in-memory if migrate applies\n";
p_j += "  the real DDL into that executor — do not skip apply and then tables.add every logical name.\n";
p_j += "  Evidence: sql-foundation/src/reference/memory-relational-store.ts ~283, ~322-328.\n";
p_j += "NEW-SQL-1: Align atomic-claims.md / store-contracts JSDoc with decideWebhookClaim: idle hash mismatch\n";
p_j += "  supersedes; conflict only under an active lease.\n";
p_j += "Write " + root + "/docs/audits/leftover-audit-r4-fix-pass-2026-08-16.md with stream ownership and residual IDs.\n";
p_j += "List blocking: NEW-MOYASAR-REFUND-ID, NEW-PAYMOB-4XX, NEW-PAYPAL-3.\n";
p_j += "List other P1: NEW-WEBHOOKS-2.\n";
p_j += "List P2 pack from " + audit_doc + ".\n";

let jobs = [
    #{ prompt: p_a, label: "fix:stripe", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:paypal", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:paymob", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:moyasar", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:webhooks", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:stores", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:core", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_h, label: "fix:routing", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_i, label: "fix:testkit-obs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_j, label: "fix:docs-sql", capability_mode: "all", output_schema: implement_schema },
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
p_int += "Integrate leftover-audit-r4-fix-gate streams in " + root + ". Do NOT commit.\n";
p_int += "1) git status / diff — fix any broken TS from parallel streams.\n";
p_int += "2) bun run typecheck across monorepo — fix all errors from our changes.\n";
p_int += "3) bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso until green (known sql-foundation bun:sqlite WAL flake may remain — isolate if needed).\n";
p_int += "4) Cross-check invariants from " + audit_doc + ":\n";
p_int += "   - NEW-MOYASAR-REFUND-ID: refund 200 {} is not pending+completed fence\n";
p_int += "   - NEW-PAYMOB-4XX: 408 after mutation keeps fence; Payment Keys 4xx after Orders 200 keeps create fence\n";
p_int += "   - NEW-PAYPAL-3: missing final_capture is not paid\n";
p_int += "5) Update " + root + "/docs/audits/leftover-audit-r4-fix-pass-2026-08-16.md with what landed vs remaining.\n";
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
p_ver += "Verify leftover-audit-r4 fixes in " + root + " with command evidence and file reads.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso\n";
p_ver += "3) Invariant greps/reads (must hold):\n";
p_ver += "   - NEW-MOYASAR-REFUND-ID: refundPayment calls assertObservedPaymentId\n";
p_ver += "   - NEW-PAYMOB-4XX: unknownOnServerError treats 408/409/425 as indeterminate; fence retained\n";
p_ver += "   - NEW-PAYPAL-3: missing final_capture is not paid\n";
p_ver += "   - NEW-CORE-8 rematch capture.completed on partial\n";
p_ver += "   - NEW-STRIPE-VOID-1 requireStripeMutationStatus on void\n";
p_ver += "   - NEW-CORE-9/10 infer/coerce leftovers\n";
p_ver += "   - NEW-WH-1 no domain-type inbox class fallback\n";
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
p_gate += "Adversarially gate PayKernel leftover-audit-r4-fix-gate in " + root + ".\n";
p_gate += "Skeptical: read actual code with read_file/grep. Do NOT trust implement summaries.\n";
p_gate += "BLOCKING if still broken:\n";
p_gate += "NEW-MOYASAR-REFUND-ID: refund 200 {} still pending + fence completed\n";
p_gate += "NEW-PAYMOB-4XX: 408 after POST still deletes fence; Payment Keys 4xx after Orders 200 still releases create\n";
p_gate += "NEW-PAYPAL-3: missing final_capture still paid\n";
p_gate += "Also list as blocking if still money lies: NEW-WEBHOOKS-2 (same-id later snapshot still swallows void),\n";
p_gate += "NEW-CORE-8 capture.completed on partial via handleWebhook, NEW-STRIPE-VOID-1 declined on missing status.\n";
p_gate += "P0: typecheck or tests red (ignore known sql-foundation WAL flake if isolated).\n";
p_gate += "Non-blocking residual PERF-5/6/7 allowed if documented.\n";
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
    p_fix += "Fix remaining BLOCKING leftover-audit-r4 issues in " + root + ".\n";
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
    p_fix += "Priority: NEW-MOYASAR-REFUND-ID, NEW-PAYMOB-4XX, NEW-PAYPAL-3, then NEW-WEBHOOKS-2, NEW-CORE-8,\n";
    p_fix += "NEW-STRIPE-VOID-1, then typecheck/tests green.\n";
    p_fix += "Read " + audit_doc + " for evidence paths. Fix surgically. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify " + root + " after remediation. Run bun run typecheck && bun test (core+webhooks+recon+routing+testkit+observability+stores).\n";
    p_ver2 += "Re-check blocking invariants from " + audit_doc + " (NEW-MOYASAR-REFUND-ID, NEW-PAYMOB-4XX, NEW-PAYPAL-3).\n";
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
p_rep += "Write fix result report to " + root + "/docs/audits/leftover-audit-r4-fix-result-2026-08-16.md\n";
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

log("paykernel-leftover-audit-r4-fix-gate complete final_pass=" + final_pass.to_string());

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
