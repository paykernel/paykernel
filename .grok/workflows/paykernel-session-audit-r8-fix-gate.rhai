let meta = #{
    name: "paykernel-session-audit-r8-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every 2026-08-19 r8 session-audit finding",
    phases: [
        #{ title: "Critic", detail: "reconfirm every S20 ID against current code" },
        #{ title: "Fix", detail: "parallel non-overlapping streams for confirmed findings" },
        #{ title: "Integrate", detail: "typecheck, tests, cross-stream consistency" },
        #{ title: "Verify", detail: "typecheck + tests + fingerprint/fence invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "fix remaining blockers if any" },
        #{ title: "Report", detail: "write fix-result under docs/audits" },
    ],
    when_to_use: "After session-audit-2026-08-19-r8; critic then fix then verify then gate all listed IDs",
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

let audit_doc = root + "/docs/audits/session-audit-2026-08-19-r8.md";

phase("Critic");
log("Critic: reconfirming 2026-08-19 r8 session-audit findings in " + root);

let p_critic = "";
p_critic += "Recheck findings from " + audit_doc + " against CURRENT source at " + root + ".\n";
p_critic += "READ-ONLY. Use read_file and grep. For each ID: STILL PRESENT or ALREADY FIXED with file:line.\n";
p_critic += "Do not edit files. Do not commit. Do not trust the audit doc alone — re-read the cited functions.\n\n";
p_critic += "MUST CHECK BLOCKING:\n";
p_critic += "S20-FINGERPRINT-REDACT: fingerprintParams hashes redact() so billing/otp/13-digit ids collide.\n";
p_critic += "S20-DOCS-FULFILL: hooks.md / webhooks.md teach fulfill in onWebhookVerified or any claimed event.\n\n";
p_critic += "MUST CHECK SHOULD-FIX: S20-SETUP-INFER S20-FAILED-DECLINED S20-WH-FAIL-RECLAIM S20-HEARTBEAT-RACE S20-MEM-GET-WIPE S20-REDIS-IFMATCH-EMPTY S20-CLAIM-DUE-N S20-LIST-NOW S20-SQLITE-MEMORY S20-PAYPAL-REFUND-UNKNOWN S20-PAYMOB-REDIR-TERM S20-PAYMOB-AMOUNT-REFUND.\n";
p_critic += "Nits if still present: S20-PAYPAL-JSON S20-PAYMOB-SUCCESS-OMIT S20-CREATE-COUNT S20-TRAILING-ZERO S20-RETRY-NAN.\n";
p_critic += "Do NOT re-open r7 S19 blocking IDs or 2026-08-18 C1 unless the original lie is back.\n";
p_critic += "Return confirmed[], already_fixed[], summary. Each confirmed entry is ID — one-line evidence.\n";

let critic = agent(p_critic, #{
    label: "critic:reconfirm",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
if critic != () && critic.success && critic.output != () && critic.output.summary != () {
    log("Critic: " + critic.output.summary);
}

phase("Fix");
log("Fixing 2026-08-19 r8 findings in parallel streams");

let common = "";
common += "Repo root: " + root + "\n";
common += "Audit source of truth: " + audit_doc + " — read YOUR IDs before editing.\n";
common += "Package: PayKernel monorepo (Bun + TypeScript). Do NOT commit. Do NOT push.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; add/flip unit tests that lock the lie;\n";
common += "re-read changed regions; prefer existing PaymentStatus values;\n";
common += "fail-closed on incomplete money; never convert uncertain mutation outcomes into a retryable failure that clears a fence;\n";
common += "ALWAYS publish currency together with major-unit amount fields;\n";
common += "Do not undo 2026-08-18 C1 (unexpanded PI + amount_received>0 is paid when no refund evidence).\n";
common += "Do not undo r7 S19 closes (checkout timeout indeterminate, Paymob parseJson, redirect paid demote, ifMatch on processRetryable).\n";
common += "Run bun test on touched test files when possible. Skip items critic proves already fixed.\n";
common += "OWN FILES ONLY — do not edit other streams files.\n";
common += "Return JSON {ok, files_changed, summary, notes, fixed_ids}.\n";

let p_a = "";
p_a += common;
p_a += "STREAM A — FINGERPRINT + MONEY TRAILING ZEROS. OWN:\n";
p_a += "- " + root + "/packages/core/src/utils/idempotency.ts\n";
p_a += "- " + root + "/packages/core/src/utils/utils.test.ts\n";
p_a += "- " + root + "/packages/core/src/utils/money.ts\n";
p_a += "- " + root + "/packages/core/src/utils/money.test.ts\n";
p_a += "- " + root + "/packages/core/src/utils/money.edge.test.ts if needed\n";
p_a += "Do NOT edit logger.ts redaction of logs. Change fingerprint identity only.\n";
p_a += "Do NOT edit gateways, stores, docs, examples.\n";
p_a += "FIX S20-FINGERPRINT-REDACT (BLOCKING): persist sha256 of canonical params, but sensitive leaves must be hashed not constant [REDACTED].\n";
p_a += "Two billing bags / two otpValue / two 13-digit gatewayPaymentIds MUST NOT share a fingerprint.\n";
p_a += "Card numbers must not appear in the digest plaintext; hash the leaf so Visa vs MC still differ.\n";
p_a += "Do not PAN-redact allow-listed ids (gatewayPaymentId, orderId, paymentId).\n";
p_a += "Economically identical money amounts must still collide. Keep AbortSignal strip.\n";
p_a += "Flip utils.test.ts Visa/MC same-fingerprint test.\n";
p_a += "FIX S20-TRAILING-ZERO: strip unused trailing-zero remainder before excess_precision reject so money(\"10.500\",\"USD\") and money(\"100.00\",\"JPY\") parse.\n";

let p_b = "";
p_b += common;
p_b += "STREAM B — PHASE-6 OUTCOMES + RETRY. OWN:\n";
p_b += "- " + root + "/packages/core/src/types/operation-result.ts\n";
p_b += "- " + root + "/packages/core/src/types/operation-result.test.ts\n";
p_b += "- " + root + "/packages/core/src/types/operation-results.acceptance.test.ts if needed\n";
p_b += "- " + root + "/packages/core/src/utils/retry.ts\n";
p_b += "- " + root + "/packages/core/src/utils/utils.test.ts ONLY if you add retry tests in a new retry.test or existing retry section — prefer packages/core/src/utils retry tests without fighting stream A fingerprint tests; add retry cases in a dedicated describe if the file is shared, do not revert stream A fingerprint tests.\n";
p_b += "If utils.test.ts is contested, put retry tests in packages/core/src/utils/retry.ts neighbor test file you create: retry.test.ts under utils.\n";
p_b += "Do NOT edit idempotency.ts or money.ts (stream A). Do NOT edit gateways.\n";
p_b += "FIX S20-SETUP-INFER: inferOperationOutcome success+setup_completed is succeeded (not failed). isPaidOutcome stays false.\n";
p_b += "FIX S20-FAILED-DECLINED: bare status failed without decline object is failed not declined.\n";
p_b += "FIX S20-RETRY-NAN: sanitize maxAttempts to finite integer >= 1 so NaN cannot throw undefined.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — DOCS SAMPLES. OWN:\n";
p_c += "- " + root + "/packages/core/docs/hooks.md\n";
p_c += "- " + root + "/packages/core/docs/webhooks.md\n";
p_c += "- " + root + "/packages/core/README.md\n";
p_c += "- " + root + "/docs/getting-started.md\n";
p_c += "Do NOT edit examples (stream J). Do NOT edit src except you may NOT edit src at all.\n";
p_c += "FIX S20-DOCS-FULFILL (BLOCKING): never fulfill in onWebhookVerified.\n";
p_c += "Inbox handler must gate payment.succeeded|capture.completed AND payment.status===paid and bind gatewayPaymentId.\n";
p_c += "getting-started recon snapshot must use getPayment money, not local trusted/catalog amount.\n";
p_c += "Core README webhook sample: claim via inbox then paid rematch; do not fulfill on event.status alone.\n";
p_c += "Match examples/checkout-kernel isPaidFulfillmentEvent + findOrderForEvent bind.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — PAYPAL GATEWAY. OWN:\n";
p_d += "- " + root + "/packages/core/src/gateways/paypal/**\n";
p_d += "- " + root + "/packages/core/docs/paypal.md if needed\n";
p_d += "Do NOT edit other gateways. Do NOT edit webhook-event-map.\n";
p_d += "FIX S20-PAYPAL-REFUND-UNKNOWN: HTTP 200 unknown refund status must be pending or indeterminate, never failed.\n";
p_d += "Flip paypal.gateway.test.ts WEIRD_NEW_STATUS -> failed.\n";
p_d += "FIX S20-PAYPAL-JSON: parseJsonResponse must not return {} on empty/invalid JSON.\n";
p_d += "Mutating empty/non-JSON stays afterProviderSubmit indeterminate; GET throws GatewayApiError without inventing {}.\n";

let p_e = "";
p_e += common;
p_e += "STREAM E — PAYMOB GATEWAY. OWN:\n";
p_e += "- " + root + "/packages/core/src/gateways/paymob/**\n";
p_e += "- " + root + "/packages/core/docs/paymob.md if needed\n";
p_e += "Do NOT edit webhook-event-map.ts (stream F).\n";
p_e += "FIX S20-PAYMOB-REDIR-TERM: redirectEnvelopeStatus demotes cancelled/failed/refund_completed/refunded-like to processing (already demotes paid/authorized).\n";
p_e += "Flip tests that lock redirect void/fail as cancelled/failed.\n";
p_e += "FIX S20-PAYMOB-SUCCESS-OMIT: identified inquiry (id + money) with omitted success is processing/unavailable, not declined.\n";
p_e += "Keep explicit success:false as failed. Flip test ~2492 if it locks omitted success -> declined.\n";

let p_f = "";
p_f += common;
p_f += "STREAM F — CORE MAPPER. OWN:\n";
p_f += "- " + root + "/packages/core/src/types/webhook-event-map.ts\n";
p_f += "- " + root + "/packages/core/src/types/payment-event.test.ts mapper tests if they live there\n";
p_f += "Do NOT edit gateways or client.ts.\n";
p_f += "FIX S20-PAYMOB-AMOUNT-REFUND: mapPaymobTransactionSignals must not amount-promote refund.completed over a decisive fromStatus (paid/cancelled/failed).\n";
p_f += "Only use amount-only refund when fromStatus is undefined.\n";
p_f += "Also demote TRANSACTION_RESPONSE dual-write of payment.cancelled / payment.failed / refund.* to payment.processing (browser GET).\n";
p_f += "Add tests for paid+refund cents without flags, and redirect cancelled/failed stables.\n";

let p_g = "";
p_g += common;
p_g += "STREAM G — WEBHOOKS ENGINE. OWN:\n";
p_g += "- " + root + "/packages/webhooks/src/engine.ts\n";
p_g += "- " + root + "/packages/webhooks/src/engine.test.ts\n";
p_g += "- " + root + "/packages/webhooks/src/engine.crash.test.ts if needed\n";
p_g += "- " + root + "/packages/webhooks/docs/** if needed\n";
p_g += "Do NOT edit memory-store.ts (stream I). Do NOT edit examples. Do NOT edit recon scheduler.\n";
p_g += "FIX S20-WH-FAIL-RECLAIM: bestEffortRecordFailAfterLeaseLost must claim with ifMatchPayloadHash = args.payloadHash.\n";
p_g += "On payload_hash_conflict skip — do not rewrite idle newer hash. Add get->reclaim race test.\n";
p_g += "FIX S20-HEARTBEAT-RACE (engine only): closed flag so renew after stopHeartbeat cannot rotate token used by complete.\n";
p_g += "Keep processRetryable ifMatch (S19) intact.\n";

let p_h = "";
p_h += common;
p_h += "STREAM H — RECONCILIATION SCHEDULER. OWN:\n";
p_h += "- " + root + "/packages/reconciliation/src/scheduler.ts\n";
p_h += "- " + root + "/packages/reconciliation/src/scheduler.test.ts\n";
p_h += "- " + root + "/packages/reconciliation/README.md\n";
p_h += "Do NOT edit store adapters (stream I). Do NOT edit webhooks engine.\n";
p_h += "FIX S20-CLAIM-DUE-N: claimDue must not be documented as a serial worker over N live leases.\n";
p_h += "Prefer claim-one-and-return OR README/types: production workers use processDue only; claimDue is discovery.\n";
p_h += "If you keep bulk return, types must warn. Prefer processDue as the only production loop.\n";
p_h += "FIX S20-HEARTBEAT-RACE (scheduler only): closed flag in runProcessDueHandlerUnderLease so renew after stop cannot rotate before complete.\n";

let p_i = "";
p_i += common;
p_i += "STREAM I — STORES MEMORY/REDIS/LIST/SQLITE OPEN. OWN:\n";
p_i += "- " + root + "/packages/testkit/src/memory/memory-stores.ts\n";
p_i += "- " + root + "/packages/webhooks/src/memory-store.ts\n";
p_i += "- " + root + "/packages/reconciliation/src/memory-store.ts\n";
p_i += "- matching memory-store tests in those packages\n";
p_i += "- " + root + "/packages/store-redis/src/scripts/webhook-inbox.lua.ts\n";
p_i += "- " + root + "/packages/store-redis/src/stores/webhook-inbox-store.ts\n";
p_i += "- " + root + "/packages/store-redis/src/stores/stores.mock.test.ts if needed\n";
p_i += "- " + root + "/packages/store-postgres/src/stores/** listDue/listRetryable wipe clock only\n";
p_i += "- " + root + "/packages/store-sqlite/src/stores/** list wipe clock + open helpers under drivers/\n";
p_i += "- " + root + "/packages/store-turso/src/stores/** list wipe clock\n";
p_i += "- " + root + "/packages/store-d1/src/stores/** list wipe clock\n";
p_i += "- " + root + "/packages/store-durable-objects/src/stores/** webhook list wipe clock if still using input.now\n";
p_i += "Do NOT edit sql-foundation claim UPSERT unless required for ifMatch empty-string.\n";
p_i += "Do NOT edit reconciliation scheduler (stream H) or webhooks engine (stream G).\n";
p_i += "FIX S20-MEM-GET-WIPE: memory webhook/recon get() is read-only (no releaseExpiredLease).\n";
p_i += "FIX S20-REDIS-IFMATCH-EMPTY: empty string is NOT omit; omit only missing/NULL. Reject empty hashes.\n";
p_i += "FIX S20-LIST-NOW: listDue/listRetryable wipe with store/issuer clock; caller now is filter only.\n";
p_i += "FIX S20-SQLITE-MEMORY: production open helpers must not default path to :memory:; require explicit path.\n";
p_i += "Apply busy_timeout on file-backed factories if cheap.\n";

let p_j = "";
p_j += common;
p_j += "STREAM J — EXAMPLES. OWN:\n";
p_j += "- " + root + "/examples/**\n";
p_j += "Do NOT edit packages/*.\n";
p_j += "FIX S20-CREATE-COUNT: GET /internal/create-count 404 unless enableTestHooks (same as reconcile).\n";
p_j += "Flip tests that expect create-count without the flag.\n";

let p_k = "";
p_k += common;
p_k += "STREAM K — AUDIT BOOKKEEPING. OWN:\n";
p_k += "- " + root + "/docs/audits/**\n";
p_k += "Do NOT edit production src.\n";
p_k += "Write " + root + "/docs/audits/session-audit-r8-fix-pass-2026-08-19.md with stream ownership and IDs.\n";
p_k += "List blocking: S20-FINGERPRINT-REDACT S20-DOCS-FULFILL.\n";
p_k += "Do not claim gate pass here.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:fingerprint", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:outcomes", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:docs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:paypal", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:paymob", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:mapper", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:webhooks", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_h, label: "fix:recon", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_i, label: "fix:stores", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_j, label: "fix:examples", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_k, label: "fix:bookkeeping", capability_mode: "all", output_schema: implement_schema },
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

phase("Integrate");
let p_int = "";
p_int += "Integrate paykernel-session-audit-r8-fix-gate streams in " + root + ". Do NOT commit.\n";
p_int += "1) git status / diff — fix any broken TS from parallel streams.\n";
p_int += "2) bun run typecheck — fix all errors from our changes.\n";
p_int += "3) bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples until green.\n";
p_int += "4) Cross-check invariants from " + audit_doc + ":\n";
p_int += "   - S20-FINGERPRINT-REDACT: two billing bags / otpValues / 13-digit ids do not share fingerprint\n";
p_int += "   - S20-DOCS-FULFILL: no onWebhookVerified fulfill samples\n";
p_int += "   - S20-WH-FAIL-RECLAIM: reclaim uses ifMatchPayloadHash\n";
p_int += "   - S20-PAYPAL-REFUND-UNKNOWN: unknown refund 200 is not failed\n";
p_int += "   - S20-PAYMOB-REDIR-TERM: redirect cancelled/failed is processing\n";
p_int += "   - C1 still holds: unexpanded PI + amount_received>0 is paid without refund snapshot\n";
p_int += "5) Update " + root + "/docs/audits/session-audit-r8-fix-pass-2026-08-19.md with what landed vs remaining.\n";
p_int += "6) Flip any remaining tests locking the r8 lies.\n";
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

phase("Verify");
let p_ver = "";
p_ver += "Verify session-audit-r8 fixes in " + root + " with command evidence and file reads.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples\n";
p_ver += "3) Invariant greps/reads (must hold):\n";
p_ver += "   - S20-FINGERPRINT-REDACT: fingerprintParams does not constant-replace PAN/otp/email leaves\n";
p_ver += "   - S20-WH-FAIL-RECLAIM: bestEffortRecordFailAfterLeaseLost sets ifMatchPayloadHash\n";
p_ver += "   - S20-MEM-GET-WIPE: memory get() does not releaseExpiredLease\n";
p_ver += "   - S20-PAYPAL-REFUND-UNKNOWN: mapRefundStatus unknown is not failed\n";
p_ver += "   - C1 unexpanded amount_received still paid\n";
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

phase("Gate");
let p_gate = "";
p_gate += "Adversarially gate PayKernel session-audit-r8-fix-gate in " + root + ".\n";
p_gate += "Skeptical: read actual code with read_file/grep. Do NOT trust implement summaries.\n";
p_gate += "BLOCKING if still broken:\n";
p_gate += "S20-FINGERPRINT-REDACT: two billing/otp/13-digit ids still share fingerprint\n";
p_gate += "S20-DOCS-FULFILL: hooks.md or webhooks.md still fulfill in onWebhookVerified / any claimed event\n";
p_gate += "S20-WH-FAIL-RECLAIM: reclaim still omits ifMatchPayloadHash\n";
p_gate += "S20-PAYPAL-REFUND-UNKNOWN: unknown refund 200 still failed\n";
p_gate += "S20-PAYMOB-REDIR-TERM: redirect cancelled/failed still terminal on envelope\n";
p_gate += "P0: typecheck or tests red (ignore known isolated WAL flake / live-Redis skip).\n";
p_gate += "Should-fix leftovers as non_blocking unless they create money/fulfillment/fence lies — then promote to blocking.\n";
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

phase("Remediate");
if (blocking != () && blocking.len() > 0) || typecheck_ok != true || tests_ok != true || invariants_ok != true {
    log("Remediating blocking issues");
    let p_fix = "";
    p_fix += "Fix remaining BLOCKING session-audit-r8 issues in " + root + ".\n";
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
    p_fix += "Priority: S20-FINGERPRINT-REDACT S20-DOCS-FULFILL S20-WH-FAIL-RECLAIM S20-PAYPAL-REFUND-UNKNOWN S20-PAYMOB-REDIR-TERM, then typecheck/tests green.\n";
    p_fix += "Read " + audit_doc + " for evidence paths. Fix surgically. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: rem_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify " + root + " after remediation. Run bun run typecheck and bun test core+webhooks+recon+store-postgres+store-redis+store-sqlite+store-durable-objects+examples.\n";
    p_ver2 += "Re-check blocking S20 IDs from " + audit_doc + ".\n";
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

phase("Report");
let final_pass = gate_pass == true && typecheck_ok == true && tests_ok == true && invariants_ok == true;

let p_rep = "";
p_rep += "Write fix result report to " + root + "/docs/audits/session-audit-r8-fix-result-2026-08-19.md\n";
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

log("paykernel-session-audit-r8-fix-gate complete final_pass=" + final_pass.to_string());

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
