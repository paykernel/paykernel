let meta = #{
    name: "paykernel-leftover-audit-r5-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every 2026-08-18 leftover (round-5) finding",
    phases: [
        #{ title: "Critic", detail: "reconfirm every leftover-audit-r5 ID against current code" },
        #{ title: "Fix", detail: "parallel non-overlapping streams for residual findings" },
        #{ title: "Integrate", detail: "typecheck, tests, cross-stream consistency" },
        #{ title: "Verify", detail: "typecheck + tests + money-fence invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "fix remaining blockers if any" },
        #{ title: "Report", detail: "write fix-result under docs/audits" },
    ],
    when_to_use: "After leftover-audit-r5-2026-08-18 SHIP_BLOCKED; fix every residual NEW-* ID from that pass",
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

let audit_doc = root + "/docs/audits/leftover-audit-r5-2026-08-18.md";

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: reconfirming leftover-audit-r5 findings in " + root);

let p_critic = "";
p_critic += "Recheck findings from " + audit_doc + " against CURRENT source at " + root + ".\n";
p_critic += "READ-ONLY. Use read_file and grep. For each ID: STILL PRESENT or ALREADY FIXED with file:line.\n";
p_critic += "Do not edit files. Do not commit. Do not trust the audit doc alone — re-read the cited functions.\n\n";
p_critic += "MUST CHECK BLOCKING:\n";
p_critic += "NEW-PAYPAL-7: capturePayment sale/order omitted final_capture still paid via requestFinalCapture=true.\n";
p_critic += "NEW-STRIPE-REFUND-0: getTotalRefundedForPaymentIntent returns 0 on empty list; published as totalRefunded.\n";
p_critic += "NEW-MOYASAR-JSON-1: parseJsonResponse HTTP 200 invalid JSON is GatewayApiError not NetworkError.afterProviderSubmit.\n";
p_critic += "NEW-WH-KEY-1: extractInboxDomainStatus only top-level status; PaymentEvent payment.status ignored.\n";
p_critic += "NEW-ROUTE-CCY-1: input.currency vs amount.currency mismatch still routes.\n\n";
p_critic += "MUST CHECK OTHER P1: NEW-STORE-3/4/5 wipe-before-token; NEW-CORE-11 mapper rematch thinner than handleWebhook.\n";
p_critic += "Note P2 if still present: NEW-STRIPE-0 NEW-PERF-9 NEW-PERF-1 NEW-OBS-3 NEW-ROUTE-2 NEW-TESTKIT-FP-1.\n";
p_critic += "Do NOT re-open leftover-r4 IDs unless the original lie is still in source.\n";
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
log("Fixing leftover-audit-r5 findings in parallel streams");

let common = "";
common += "Repo root: " + root + "\n";
common += "Audit source of truth: " + audit_doc + " — read YOUR IDs before editing.\n";
common += "Package: PayKernel monorepo (Bun + TypeScript). Do NOT commit. Do NOT push.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; add/flip unit tests that lock the lie;\n";
common += "re-read changed regions; prefer existing PaymentStatus values;\n";
common += "fail-closed on incomplete money; never convert uncertain mutation outcomes into a retryable failure that clears a fence;\n";
common += "ALWAYS publish currency together with major-unit amount fields;\n";
common += "Run bun test on touched test files when possible. Skip items critic proves already fixed.\n";
common += "OWN FILES ONLY — do not edit other streams files.\n";
common += "Return JSON {ok, files_changed, summary, notes, fixed_ids}.\n";

let p_a = "";
p_a += common;
p_a += "STREAM A — STRIPE. OWN:\n";
p_a += "- " + root + "/packages/core/src/gateways/stripe/**\n";
p_a += "- " + root + "/packages/core/docs/stripe.md\n";
p_a += "Do NOT edit abort.ts, client.ts, webhook-event-map.ts, operation-result.ts, logger.ts.\n";
p_a += "FIX:\n";
p_a += "NEW-STRIPE-REFUND-0 (BLOCKING): getTotalRefundedForPaymentIntent must NOT return 0 when the list is empty\n";
p_a += "  or only pending. Omit totalRefunded unless a positive proven cumulative exists (list sum > 0 or\n";
p_a += "  charge.amount_refunded > 0). Catch fallback to amount_refunded must also run when the list yields 0,\n";
p_a += "  not only on throw. Evidence: stripe.gateway.ts ~1842-1882, ~2869-2906.\n";
p_a += "NEW-STRIPE-0: fromStripeAmount(undefined|null) must not return 0. Return undefined or throw.\n";
p_a += "  Update callers that relied on 0. Evidence: ~420-426.\n";
p_a += "Add tests: refund POST succeeded + empty refunds list does not publish totalRefunded 0;\n";
p_a += "  pending-only list does not publish 0 as completed total; fromStripeAmount missing is not 0.\n";

let p_b = "";
p_b += common;
p_b += "STREAM B — PAYPAL. OWN:\n";
p_b += "- " + root + "/packages/core/src/gateways/paypal/**\n";
p_b += "- " + root + "/packages/core/docs/paypal.md\n";
p_b += "Do NOT edit abort.ts or webhook-event-map.ts.\n";
p_b += "FIX:\n";
p_b += "NEW-PAYPAL-7 (BLOCKING): capturePayment sale/order path must treat omitted final_capture as NOT paid.\n";
p_b += "  Do not fall back to requestFinalCapture=true when the request never sent final_capture.\n";
p_b += "  Same rule as GET / webhook: paid only when final_capture === true. Omitted → partially_captured.\n";
p_b += "  Flip test should capture order and return capture ID (currently locks paid without final_capture).\n";
p_b += "  Evidence: paypal.gateway.ts ~626-694; paypal.gateway.test.ts ~3186-3226.\n";
p_b += "NEW-PERF-1 (PayPal): parseWebhookEvent payload hash should be compact identity (id/type/create_time/resource.id),\n";
p_b += "  not the full raw tree — Stripe PERF-6 shape. Do not break hash-source honesty tests; if a test locks\n";
p_b += "  full-body hash, flip it to compact identity and document.\n";
p_b += "Add tests: order capture HTTP 200 COMPLETED without final_capture is not paid / not isPaidOutcome.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — MOYASAR. OWN:\n";
p_d += "- " + root + "/packages/core/src/gateways/moyasar/**\n";
p_d += "- " + root + "/packages/core/docs/moyasar.md\n";
p_d += "Do NOT edit abort.ts or client.ts.\n";
p_d += "FIX:\n";
p_d += "NEW-MOYASAR-JSON-1 (BLOCKING): parseJsonResponse after a mutating HTTP 2xx with unreadable JSON must throw\n";
p_d += "  NetworkError({ afterProviderSubmit: true }), not GatewayApiError status 200.\n";
p_d += "  executeWithHooks then returns indeterminate; runIdempotentMutation keeps fence unknown.\n";
p_d += "  GET / non-mutating 2xx may stay GatewayApiError. Evidence: moyasar.gateway.ts ~1774-1786.\n";
p_d += "NEW-PERF-1 (Moyasar): webhook payload hash should be compact identity like Stripe, not full tree.\n";
p_d += "Add tests: refund/capture HTTP 200 invalid JSON is indeterminate, fence unknown, same key does not POST again.\n";

let p_e = "";
p_e += common;
p_e += "STREAM E — WEBHOOKS engine. OWN:\n";
p_e += "- " + root + "/packages/webhooks/src/**\n";
p_e += "- " + root + "/packages/webhooks/docs/**\n";
p_e += "- " + root + "/packages/webhooks/README.md\n";
p_e += "Do NOT edit webhook-event-map.ts (stream G). Do NOT edit testkit (stream F/I).\n";
p_e += "FIX:\n";
p_e += "NEW-WH-KEY-1 (BLOCKING): extractInboxDomainStatus must read rec.status, rec.payment.status, rec.refund.status,\n";
p_e += "  and the same paths on nested event (PersistedPaymentEventEnvelope). Redirect TRANSACTION_RESPONSE still\n";
p_e += "  ignores status. Recommended path event: webhookEvent.event (PaymentEvent) must produce\n";
p_e += "  paymob:TRANSACTION:{id}:{status} when payment.status is present.\n";
p_e += "  Evidence: engine.ts ~713-720; README ~61; PaymentEvent has no top-level status.\n";
p_e += "Add test: PaymentEvent type payment.succeeded + payment.status paid then payment.cancelled +\n";
p_e += "  payment.status cancelled are not already_completed (NEW-WH-KEY-1).\n";

let p_f = "";
p_f += common;
p_f += "STREAM F — STORES + recon/testkit memory. OWN:\n";
p_f += "- " + root + "/packages/testkit/src/memory/**\n";
p_f += "- " + root + "/packages/reconciliation/src/memory-store.ts\n";
p_f += "- " + root + "/packages/reconciliation/src/memory-store.test.ts\n";
p_f += "- " + root + "/packages/store-postgres/src/stores/idempotency-store.ts\n";
p_f += "- " + root + "/packages/store-sqlite/src/stores/idempotency-store.ts\n";
p_f += "- " + root + "/packages/store-d1/src/stores/idempotency-store.ts\n";
p_f += "- " + root + "/packages/store-turso/src/stores/idempotency-store.ts\n";
p_f += "- " + root + "/packages/store-durable-objects/src/stores/idempotency-store.ts\n";
p_f += "Do NOT edit webhooks/src (stream E). Do NOT edit testkit/src/mock (stream I).\n";
p_f += "FIX:\n";
p_f += "NEW-STORE-3: testkit webhook complete/renew must token-fence FIRST (match packages/webhooks/src/memory-store.ts).\n";
p_f += "  Do not releaseExpiredLease before checking claimed + token. Evidence: testkit memory-stores.ts ~572-599.\n";
p_f += "NEW-STORE-4: testkit idempotency expireIfNeeded must NOT run in get/markIndeterminate before token fence.\n";
p_f += "  markIndeterminate must succeed on expired reserved with matching token (A4). get is read-only.\n";
p_f += "  Evidence: ~228-246, ~373-398.\n";
p_f += "NEW-STORE-5: recon-package complete/renew/markManualReview token-first (fail already is). Testkit recon fail\n";
p_f += "  must also token-first. Evidence: reconciliation/src/memory-store.ts ~264-357; testkit recon fail ~912.\n";
p_f += "NEW-PERF-9: idempotency deleteExpired omitted limit must default 1000 (same as webhook/recon NEW-PERF-8).\n";
p_f += "  postgres/sqlite/d1/turso/DO idempotency-store.ts. Evidence: store-sqlite idempotency-store.ts ~346-351.\n";
p_f += "Add tests for wipe-before-token and default LIMIT.\n";

let p_g = "";
p_g += common;
p_g += "STREAM G — CORE mapper rematch. OWN:\n";
p_g += "- " + root + "/packages/core/src/types/webhook-event-map.ts\n";
p_g += "- " + root + "/packages/core/src/types/payment-event.test.ts\n";
p_g += "Do NOT edit client.ts (already rematches). Do NOT edit gateways.\n";
p_g += "FIX:\n";
p_g += "NEW-CORE-11: coerceStableSucceededToDomainStatus must rematch cancelled/reversed/failed/refunded/authorized\n";
p_g += "  the same way handleWebhook rematchSucceededTypeFromDomainStatus / rematchRefundCompletedTypeFromDomainStatus does.\n";
p_g += "  Apply coerce to Stripe/PayPal/Moyasar catalog returns, not only already-stable names.\n";
p_g += "  payment_intent.succeeded + refunded/failed must not stay payment.succeeded.\n";
p_g += "  PAYMENT.CAPTURE.COMPLETED + partially_captured must not stay capture.completed.\n";
p_g += "  Evidence: webhook-event-map.ts ~151-180, ~303-361, ~605-634.\n";
p_g += "Add mapper tests that lock these rematches.\n";

let p_h = "";
p_h += common;
p_h += "STREAM H — ROUTING. OWN:\n";
p_h += "- " + root + "/packages/routing/src/**\n";
p_h += "- " + root + "/packages/routing/docs/**\n";
p_h += "FIX:\n";
p_h += "NEW-ROUTE-CCY-1 (BLOCKING): if input.currency and resolved amount.currency (Money.currency or amountCurrency)\n";
p_h += "  are both present and differ, fail closed with NoRouteMatchError honesty reason. Do not match a USD rule\n";
p_h += "  when amount is EUR. Evidence: match.ts ~76-79; amount-range.ts ~23-27.\n";
p_h += "NEW-ROUTE-2: complementary-partition honesty must also cover tenant (same walk as currency/country/method).\n";
p_h += "  After exclude of the matching tenant bucket, do not unconstrained-fallback to another tenant gateway.\n";
p_h += "Add tests: USD input.currency + EUR Money amount does not route; tenant partitions honesty-block fallback.\n";

let p_i = "";
p_i += common;
p_i += "STREAM I — OBS + logger + testkit mock. OWN:\n";
p_i += "- " + root + "/packages/observability/src/**\n";
p_i += "- " + root + "/packages/core/src/utils/logger.ts\n";
p_i += "- " + root + "/packages/core/src/utils/utils.test.ts if logger tests live there\n";
p_i += "- " + root + "/packages/testkit/src/mock/**\n";
p_i += "Do NOT edit testkit/src/memory (stream F). Do NOT edit gateways.\n";
p_i += "FIX:\n";
p_i += "NEW-OBS-3: redact / SECRET_SHAPED_STRING / observability residual pass must match seti_*_secret_*\n";
p_i += "  and PayPal-style A21AA access tokens (or A21 + long alnum) on string leaves AND logger/span messages.\n";
p_i += "  Evidence: logger.ts ~115-116; observability/src/redaction.ts ~37-48.\n";
p_i += "NEW-TESTKIT-FP-1: createPaymentIdentityFields must include stripeSetupFutureUsage and paymobIframeId.\n";
p_i += "  Evidence: testkit/src/mock/mock-gateway.ts create fingerprint.\n";
p_i += "Add tests for each.\n";

let p_j = "";
p_j += common;
p_j += "STREAM J — DOCS. OWN:\n";
p_j += "- " + root + "/docs/audits/**\n";
p_j += "Do NOT edit production src except this bookkeeping.\n";
p_j += "Update leftover-audit-r5-fix-pass-2026-08-18.md with stream ownership and residual IDs.\n";
p_j += "List blocking: NEW-PAYPAL-7, NEW-STRIPE-REFUND-0, NEW-MOYASAR-JSON-1, NEW-WH-KEY-1, NEW-ROUTE-CCY-1.\n";
p_j += "Do not claim gate pass here.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:stripe", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:paypal", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:moyasar", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:webhooks", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:stores", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:core-map", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_h, label: "fix:routing", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_i, label: "fix:obs-testkit", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_j, label: "fix:docs", capability_mode: "all", output_schema: implement_schema },
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
p_int += "Integrate leftover-audit-r5-fix-gate streams in " + root + ". Do NOT commit.\n";
p_int += "1) git status / diff — fix any broken TS from parallel streams.\n";
p_int += "2) bun run typecheck across monorepo — fix all errors from our changes.\n";
p_int += "3) bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso until green.\n";
p_int += "4) Cross-check invariants from " + audit_doc + ":\n";
p_int += "   - NEW-PAYPAL-7: order capture omitted final_capture is not paid\n";
p_int += "   - NEW-STRIPE-REFUND-0: empty refund list is not totalRefunded 0\n";
p_int += "   - NEW-MOYASAR-JSON-1: mutating 200 invalid JSON is indeterminate\n";
p_int += "   - NEW-WH-KEY-1: PaymentEvent payment.status qualifies Paymob processed keys\n";
p_int += "   - NEW-ROUTE-CCY-1: currency mismatch does not route\n";
p_int += "5) Update " + root + "/docs/audits/leftover-audit-r5-fix-pass-2026-08-18.md with what landed vs remaining.\n";
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
p_ver += "Verify leftover-audit-r5 fixes in " + root + " with command evidence and file reads.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso\n";
p_ver += "3) Invariant greps/reads (must hold):\n";
p_ver += "   - NEW-PAYPAL-7: capturePayment omitted final_capture is not paid\n";
p_ver += "   - NEW-STRIPE-REFUND-0: empty list does not publish totalRefunded 0\n";
p_ver += "   - NEW-MOYASAR-JSON-1: mutating 2xx invalid JSON is NetworkError afterProviderSubmit\n";
p_ver += "   - NEW-WH-KEY-1: extractInboxDomainStatus reads payment.status\n";
p_ver += "   - NEW-ROUTE-CCY-1: currency mismatch honesty\n";
p_ver += "   - NEW-STORE-3/4/5 token-first memory mutators\n";
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
p_gate += "Adversarially gate PayKernel leftover-audit-r5-fix-gate in " + root + ".\n";
p_gate += "Skeptical: read actual code with read_file/grep. Do NOT trust implement summaries.\n";
p_gate += "BLOCKING if still broken:\n";
p_gate += "NEW-PAYPAL-7: order capture omitted final_capture still paid\n";
p_gate += "NEW-STRIPE-REFUND-0: empty refund list still totalRefunded 0\n";
p_gate += "NEW-MOYASAR-JSON-1: mutating 200 invalid JSON still thrown GatewayApiError (not indeterminate)\n";
p_gate += "NEW-WH-KEY-1: PaymentEvent payment.status still ignored for Paymob processed keys\n";
p_gate += "NEW-ROUTE-CCY-1: currency mismatch still routes\n";
p_gate += "Also list as blocking if still money lies: NEW-STORE-4 expire-then-lose reserved fence,\n";
p_gate += "NEW-CORE-11 mapper still type-only completes open money.\n";
p_gate += "P0: typecheck or tests red (ignore known sql-foundation WAL flake if isolated).\n";
p_gate += "Non-blocking residual PERF-4/5/7 allowed if documented.\n";
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
    p_fix += "Fix remaining BLOCKING leftover-audit-r5 issues in " + root + ".\n";
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
    p_fix += "Priority: NEW-PAYPAL-7, NEW-STRIPE-REFUND-0, NEW-MOYASAR-JSON-1, NEW-WH-KEY-1, NEW-ROUTE-CCY-1,\n";
    p_fix += "then NEW-STORE-3/4/5, NEW-CORE-11, then typecheck/tests green.\n";
    p_fix += "Read " + audit_doc + " for evidence paths. Fix surgically. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify " + root + " after remediation. Run bun run typecheck && bun test (core+webhooks+recon+routing+testkit+observability+stores).\n";
    p_ver2 += "Re-check blocking invariants from " + audit_doc + " (NEW-PAYPAL-7, NEW-STRIPE-REFUND-0, NEW-MOYASAR-JSON-1, NEW-WH-KEY-1, NEW-ROUTE-CCY-1).\n";
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
p_rep += "Write fix result report to " + root + "/docs/audits/leftover-audit-r5-fix-result-2026-08-18.md\n";
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

log("paykernel-leftover-audit-r5-fix-gate complete final_pass=" + final_pass.to_string());

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
