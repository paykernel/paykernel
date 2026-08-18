let meta = #{
    name: "paykernel-session-audit-r6-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every 2026-08-18 session-audit finding",
    phases: [
        #{ title: "Critic", detail: "reconfirm every session-audit ID against current code" },
        #{ title: "Fix", detail: "parallel non-overlapping streams for confirmed findings" },
        #{ title: "Integrate", detail: "typecheck, tests, cross-stream consistency" },
        #{ title: "Verify", detail: "typecheck + tests + money-fence invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "fix remaining blockers if any" },
        #{ title: "Report", detail: "write fix-result under docs/audits" },
    ],
    when_to_use: "After session-audit-2026-08-18; critic then fix then verify then gate all listed IDs",
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

let rem_schema = #{
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

let audit_doc = root + "/docs/audits/session-audit-2026-08-18.md";

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: reconfirming session-audit findings in " + root);

let p_critic = "";
p_critic += "Recheck findings from " + audit_doc + " against CURRENT source at " + root + ".\n";
p_critic += "READ-ONLY. Use read_file and grep. For each ID: STILL PRESENT or ALREADY FIXED with file:line.\n";
p_critic += "Do not edit files. Do not commit. Do not trust the audit doc alone — re-read the cited functions.\n\n";
p_critic += "MUST CHECK BLOCKING:\n";
p_critic += "C1-STRIPE-PI-UNEXPANDED: payment_intent.succeeded with latest_charge string id + amount_received>0 is processing not paid.\n";
p_critic += "I1-PAYMOB-UNSIGNED-ACTION: signed is_refunded:false + unsigned is_refund:true still verifies and maps refund_completed.\n";
p_critic += "I2-PAYMOB-MUTATION-FENCE: executeIdempotent with no key still POSTs capture/refund/void.\n";
p_critic += "I3-PAYMOB-FLAGS-PENDING: mapPaymobFromFlags ranks success before pending when status absent.\n";
p_critic += "I4-REDIS-RESERVED-KEYS: recordKey recon/due equals reconciliationDueIndexKey.\n";
p_critic += "I7-EXAMPLE-RECON-BIND: snapshotForOrder uses getLastProviderSideSuccess; create deletes order on untagged NetworkError.\n";
p_critic += "I8-HEX-TO-BYTES: hexToBytes pads odd length; parseInt accepts 0g/ag.\n";
p_critic += "I9-BEHAVIORAL-CONTRACTS: docs say timeouts throw NetworkError; Moyasar unguarded without store.\n\n";
p_critic += "MUST CHECK SHOULD-FIX: I5-LEASE-HEARTBEAT I6-DURABLE-ACK I10-MISSING-SECRET-CLASS I11-WH-SANITIZE I12-RECON-SANITIZE I13-WH-PAYMOB-STATUS I14-STALE-HASH-SUPERSEDE I15-DO-ENSURE-SCHEMA I16-EXAMPLE-PROVIDER-PAID.\n";
p_critic += "Do NOT re-open leftover-r5 IDs unless the original lie is still in source.\n";
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
log("Fixing session-audit findings in parallel streams");

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
p_a += "Do NOT edit client.ts, webhook-event-map.ts, crypto-portable.ts, paymob, paypal, moyasar.\n";
p_a += "FIX C1-STRIPE-PI-UNEXPANDED (BLOCKING):\n";
p_a += "succeededPaymentIntentWebhookStatus currently returns processing when latest_charge is a string id,\n";
p_a += "BEFORE reading amount_received. Stripe default PI webhooks send latest_charge as ch_… plus amount_received.\n";
p_a += "If amount_received is finite and > 0, map to paid unless an EXPANDED charge snapshot proves a refund\n";
p_a += "(amount_refunded>0 or refunded:true). Keep processing only when settled money is missing.\n";
p_a += "Mutation path may keep unexpandedCharge: ignore.\n";
p_a += "Flip stripe.gateway.test.ts STRIPE-2 unexpanded+amount_received fixture to expect paid + payment.succeeded.\n";
p_a += "Keep a test that unexpanded + MISSING amount_received stays processing.\n";
p_a += "Keep a test that expanded charge with amount_refunded>0 is not paid.\n";
p_a += "Optional I10 for Stripe only: missing webhookSecret should throw InvalidRequestError (config), not return false\n";
p_a += "(forgery). If you change this, update Stripe verify tests. Do not change engine classification here.\n";

let p_b = "";
p_b += common;
p_b += "STREAM B — PAYMOB GATEWAY. OWN:\n";
p_b += "- " + root + "/packages/core/src/gateways/paymob/**\n";
p_b += "- " + root + "/packages/core/docs/paymob.md\n";
p_b += "Do NOT edit webhook-event-map.ts (stream G). Do NOT edit webhooks package.\n";
p_b += "FIX I1-PAYMOB-UNSIGNED-ACTION (BLOCKING):\n";
p_b += "If is_refunded is present (true OR false), ignore unsigned is_refund on webhook sanitize/status.\n";
p_b += "Honor is_refund only when is_refunded is absent (HMAC alias). Same for is_voided / is_void.\n";
p_b += "Child refunds: signed has_parent_transaction + the SIGNED flag only.\n";
p_b += "Flip tests that expect forged is_refund next to signed is_refunded:false to stay paid / not refund_completed.\n";
p_b += "FIX I2-PAYMOB-MUTATION-FENCE (BLOCKING):\n";
p_b += "capture/refund/void must throw InvalidRequestError without idempotencyStore.reserve + idempotencyKey.\n";
p_b += "Parity with Moyasar runIdempotentMutation. Create/get/webhook stay unfenced.\n";
p_b += "Add tests: omitted key does not POST; store without reserve throws.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — CRYPTO + CONTRACT DOCS. OWN:\n";
p_c += "- " + root + "/packages/core/src/runtime/crypto-portable.ts\n";
p_c += "- " + root + "/packages/core/src/runtime/crypto-portable.test.ts\n";
p_c += "- " + root + "/packages/core/docs/behavioral-contracts.md\n";
p_c += "Do NOT edit gateways or webhooks.\n";
p_c += "FIX I8-HEX-TO-BYTES (BLOCKING): reject odd length and non-hex. Do not pad. Do not use parseInt for nibbles.\n";
p_c += "Match JSDoc. Update tests (odd length throws; 0g/ag throw; abc != 0abc).\n";
p_c += "FIX I9-BEHAVIORAL-CONTRACTS (BLOCKING): post-submit timeout/connection drop after a mutating POST returns\n";
p_c += "outcome indeterminate / reconciliationRequired via executeWithHooks, not a thrown NetworkError that callers\n";
p_c += "treat as failed-create. Moyasar capture/refund/void REQUIRE store.reserve + idempotencyKey (throw if missing).\n";
p_c += "Rewrite the stale paragraphs. Keep other contract tables accurate.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — WEBHOOKS ENGINE. OWN:\n";
p_d += "- " + root + "/packages/webhooks/src/**\n";
p_d += "- " + root + "/packages/webhooks/docs/**\n";
p_d += "- " + root + "/packages/webhooks/README.md\n";
p_d += "Do NOT edit examples (stream F). Do NOT edit gateways.\n";
p_d += "FIX I5-LEASE-HEARTBEAT: while runHandlerUnderLease awaits handler, auto-renew on an interval (~leaseMs/3).\n";
p_d += "If renew is lease_lost, stop treating the run as owner (handler_failed retryable). Keep ctx.renew().\n";
p_d += "FIX I6-DURABLE-ACK: ackAfterClaim / parked ACK must require explicit workerGuaranteed:true (or equivalent)\n";
p_d += "on engine options. Without it, do not return scheduled_for_retry parked that hosts map to 200.\n";
p_d += "Refuse or return retryable handler_failed. Document in webhook-inbox.md.\n";
p_d += "FIX I10-MISSING-SECRET-CLASS: classify InvalidRequestError about missing webhookSecret/hmacSecret/webhookId\n";
p_d += "as permanent or retryable config — NEVER forgery invalid_webhook. Prefer retryable 5xx-class handler_failed\n";
p_d += "so providers redeliver after the merchant adds the secret. Verify-false MAC mismatch stays forgery.\n";
p_d += "FIX I11-WH-SANITIZE: scrub cs_live_/cs_test_, csk_, pi_|seti_…_secret_…, PayPal A21AA…, and PAN digit runs\n";
p_d += "(same residual set as packages/observability/src/redaction.ts). Add tests.\n";
p_d += "FIX I13-WH-PAYMOB-STATUS: when nested event/refund exists, do not let top-level WebhookEvent.status paid\n";
p_d += "qualify processed keys. Prefer refund.status / payment.status from PaymentEvent. Redirect still ignores status.\n";
p_d += "FIX I14-STALE-HASH-SUPERSEDE: processRetryable claim must not overwrite a newer idle payloadHash with the\n";
p_d += "listed stale hash. If row hash != listed hash, skip or re-read; do not supersede backwards.\n";

let p_e = "";
p_e += common;
p_e += "STREAM E — REDIS + DO. OWN:\n";
p_e += "- " + root + "/packages/store-redis/src/**\n";
p_e += "- " + root + "/packages/store-durable-objects/src/object/payments-store-object.ts\n";
p_e += "- " + root + "/packages/store-durable-objects/src/object/** tests that cover readyStores\n";
p_e += "Do NOT edit webhooks or sql-foundation.\n";
p_e += "FIX I4-REDIS-RESERVED-KEYS (BLOCKING): recordKey / store entrypoints must reject logical keys due, retry, retain\n";
p_e += "(case-sensitive exact). Or move index keys to a distinct segment that cannot collide. Add keys.test.ts cases.\n";
p_e += "FIX I15-DO-ENSURE-SCHEMA: readyStores must ensureCachedSchema even when tableNamespace is omitted.\n";
p_e += "Fail closed on migrate errors. Add/adjust a test that default RPC path applies schema.\n";

let p_f = "";
p_f += common;
p_f += "STREAM F — EXAMPLES. OWN:\n";
p_f += "- " + root + "/examples/**\n";
p_f += "Do NOT edit packages/*.\n";
p_f += "FIX I7-EXAMPLE-RECON-BIND (BLOCKING): snapshotForOrder must NEVER call getLastProviderSideSuccess or bind\n";
p_f += "another order payment id. If gatewayPaymentId missing, return not_found / unavailable.\n";
p_f += "On create NetworkError (tagged or not), KEEP the order and schedule recon; do not orders.delete.\n";
p_f += "Do not put err.message in HTTP bodies.\n";
p_f += "FIX I6 example side: mapInboxOutcome scheduled_for_retry parked / handler_retry should be 503 unless you\n";
p_f += "document that only inline mode is supported here (kernel is inline — still do not 200 parked).\n";
p_f += "FIX I16-EXAMPLE-PROVIDER-PAID: README + route comments: test hook, not production; do not deploy unauthenticated.\n";
p_f += "Add/flip checkout-kernel tests for last-success bind and NetworkError keep-order.\n";

let p_g = "";
p_g += common;
p_g += "STREAM G — CORE MAPPER. OWN:\n";
p_g += "- " + root + "/packages/core/src/types/webhook-event-map.ts\n";
p_g += "- " + root + "/packages/core/src/types/payment-event.test.ts if mapper tests live there\n";
p_g += "- mapper tests next to webhook-event-map\n";
p_g += "Do NOT edit gateways or client.ts.\n";
p_g += "FIX I3-PAYMOB-FLAGS-PENDING (BLOCKING): in mapPaymobFromFlags, if flags.pending === true return\n";
p_g += "payment.processing BEFORE the bare flags.success === true → payment.succeeded arm.\n";
p_g += "Align comment with mapTransactionStatus (pending first). Add a test: flags success+pending, no status,\n";
p_g += "maps to payment.processing not payment.succeeded.\n";

let p_h = "";
p_h += common;
p_h += "STREAM H — RECONCILIATION SANITIZE. OWN:\n";
p_h += "- " + root + "/packages/reconciliation/src/sanitize.ts\n";
p_h += "- " + root + "/packages/reconciliation/src/sanitize.test.ts if present, else add tests nearby\n";
p_h += "Do NOT edit webhooks sanitize (stream D).\n";
p_h += "FIX I12-RECON-SANITIZE: do not persist JSON.stringify(error) raw. Reuse webhook-style secret patterns plus\n";
p_h += "object-key redaction (password, api_key, client_secret, authorization). Add tests.\n";

let p_j = "";
p_j += common;
p_j += "STREAM J — AUDIT BOOKKEEPING. OWN:\n";
p_j += "- " + root + "/docs/audits/**\n";
p_j += "Do NOT edit production src.\n";
p_j += "Update " + root + "/docs/audits/session-audit-r6-fix-pass-2026-08-18.md with stream ownership and IDs.\n";
p_j += "List blocking: C1 I1 I2 I3 I4 I7 I8 I9. Do not claim gate pass here.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:stripe", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:paymob", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:crypto-docs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:webhooks", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:redis-do", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:examples", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:mapper", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_h, label: "fix:recon-sanitize", capability_mode: "all", output_schema: implement_schema },
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
p_int += "Integrate paykernel-session-audit-r6-fix-gate streams in " + root + ". Do NOT commit.\n";
p_int += "1) git status / diff — fix any broken TS from parallel streams.\n";
p_int += "2) bun run typecheck — fix all errors from our changes.\n";
p_int += "3) bun test packages/core packages/webhooks packages/reconciliation packages/store-redis packages/store-durable-objects examples until green.\n";
p_int += "4) Cross-check invariants from " + audit_doc + ":\n";
p_int += "   - C1: PI succeeded + latest_charge string + amount_received>0 is paid\n";
p_int += "   - I1: unsigned is_refund cannot rewrite signed is_refunded:false\n";
p_int += "   - I2: Paymob capture without key throws, no POST\n";
p_int += "   - I3: flags success+pending → payment.processing\n";
p_int += "   - I4: Redis reserved keys rejected\n";
p_int += "   - I7: example never binds last-success; NetworkError keeps order\n";
p_int += "   - I8: hexToBytes rejects odd/non-hex\n";
p_int += "   - I9: behavioral-contracts matches indeterminate + Moyasar fence\n";
p_int += "5) Update " + root + "/docs/audits/session-audit-r6-fix-pass-2026-08-18.md with what landed vs remaining.\n";
p_int += "6) Flip any remaining tests locking the session-audit lies.\n";
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
p_ver += "Verify session-audit-r6 fixes in " + root + " with command evidence and file reads.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test packages/core packages/webhooks packages/reconciliation packages/store-redis packages/store-durable-objects examples\n";
p_ver += "3) Invariant greps/reads (must hold):\n";
p_ver += "   - C1 succeededPaymentIntentWebhookStatus uses amount_received before unexpanded processing\n";
p_ver += "   - I1 sanitize drops/ignores is_refund when is_refunded is boolean present\n";
p_ver += "   - I2 executeIdempotent / capture path throws without key\n";
p_ver += "   - I3 mapPaymobFromFlags pending before success\n";
p_ver += "   - I4 reserved logical keys rejected\n";
p_ver += "   - I7 no getLastProviderSideSuccess bind\n";
p_ver += "   - I8 hexToBytes throws on odd/non-hex\n";
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
p_gate += "Adversarially gate PayKernel session-audit-r6-fix-gate in " + root + ".\n";
p_gate += "Skeptical: read actual code with read_file/grep. Do NOT trust implement summaries.\n";
p_gate += "BLOCKING if still broken:\n";
p_gate += "C1-STRIPE-PI-UNEXPANDED: latest_charge string + amount_received>0 still processing\n";
p_gate += "I1-PAYMOB-UNSIGNED-ACTION: unsigned is_refund still rewrites signed paid\n";
p_gate += "I2-PAYMOB-MUTATION-FENCE: capture without key still POSTs\n";
p_gate += "I3-PAYMOB-FLAGS-PENDING: flags success+pending still payment.succeeded\n";
p_gate += "I4-REDIS-RESERVED-KEYS: recon due still collides with due index\n";
p_gate += "I7-EXAMPLE-RECON-BIND: last-success still bound or NetworkError still deletes order\n";
p_gate += "I8-HEX-TO-BYTES: still pads / parseInt junk\n";
p_gate += "I9-BEHAVIORAL-CONTRACTS: still says timeouts always throw / Moyasar unguarded\n";
p_gate += "P0: typecheck or tests red (ignore known isolated WAL flake).\n";
p_gate += "Should-fix I5 I6 I10-I16 as non_blocking if unfinished, blocking if a leftover creates money/fulfillment lies.\n";
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
    p_fix += "Fix remaining BLOCKING session-audit-r6 issues in " + root + ".\n";
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
    p_fix += "Priority: C1 I1 I2 I3 I4 I7 I8 I9, then typecheck/tests green.\n";
    p_fix += "Read " + audit_doc + " for evidence paths. Fix surgically. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: rem_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify " + root + " after remediation. Run bun run typecheck and bun test core+webhooks+recon+store-redis+store-durable-objects+examples.\n";
    p_ver2 += "Re-check C1 I1 I2 I3 I4 I7 I8 I9 from " + audit_doc + ".\n";
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
p_rep += "Write fix result report to " + root + "/docs/audits/session-audit-r6-fix-result-2026-08-18.md\n";
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

log("paykernel-session-audit-r6-fix-gate complete final_pass=" + final_pass.to_string());

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
