let meta = #{
    name: "paykernel-session-audit-r7-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every 2026-08-19 session-audit finding",
    phases: [
        #{ title: "Critic", detail: "reconfirm every S19 ID against current code" },
        #{ title: "Fix", detail: "parallel non-overlapping streams for confirmed findings" },
        #{ title: "Integrate", detail: "typecheck, tests, cross-stream consistency" },
        #{ title: "Verify", detail: "typecheck + tests + money-fence invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "fix remaining blockers if any" },
        #{ title: "Report", detail: "write fix-result under docs/audits" },
    ],
    when_to_use: "After session-audit-2026-08-19; critic then fix then verify then gate all listed IDs",
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

let audit_doc = root + "/docs/audits/session-audit-2026-08-19.md";

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: reconfirming 2026-08-19 session-audit findings in " + root);

let p_critic = "";
p_critic += "Recheck findings from " + audit_doc + " against CURRENT source at " + root + ".\n";
p_critic += "READ-ONLY. Use read_file and grep. For each ID: STILL PRESENT or ALREADY FIXED with file:line.\n";
p_critic += "Do not edit files. Do not commit. Do not trust the audit doc alone — re-read the cited functions.\n\n";
p_critic += "MUST CHECK BLOCKING:\n";
p_critic += "S19-CKO-TIMEOUT: createCheckoutSession post-submit NetworkError is thrown; not in isPostSubmitMoneyMutation.\n";
p_critic += "S19-PAYMOB-JSON: parseJson catch returns {}; getPayment empty 200 maps failed/declined.\n";
p_critic += "S19-PAYMOB-REDIR-STATUS: redirect WebhookEvent.status is paid while stableType is payment.processing.\n";
p_critic += "S19-PAYMOB-REFUND-UNPAID: resolveRemainingActionAmountCents POSTs refund/capture on failed/pending sales.\n";
p_critic += "S19-MAP-REFUND-PENDING: mapPaymobFromFlags ranks hasAmountRefund/isRefunded before flags.pending.\n";
p_critic += "S19-WH-HASH-TOCTOU: processRetryable get then claim can supersede with stale hash.\n";
p_critic += "S19-STRIPE-LATE-REFUND: PI.succeeded unexpanded latest_charge + amount_received ignores refunds; getPayment rematches.\n\n";
p_critic += "MUST CHECK SHOULD-FIX: S19-PAYMOB-LEGACY-ID S19-CKO-AMOUNT S19-CKO-GET S19-STRIPE-CHARGE-SWALLOW S19-STRIPE-DISPUTE S19-EPHEMERAL-KEY S19-CLOCK-LEASE S19-CLAIM-DUE S19-RECON-HB S19-FINGERPRINT S19-EXAMPLE-BIND S19-EXAMPLE-RECON S19-DOCS-SUCCESS.\n";
p_critic += "Nits if still present: S19-SHA256-LEN S19-RECON-PAN S19-SQLITE-ENGINES.\n";
p_critic += "Do NOT re-open 2026-08-18 C1 I1 I2 I3 I4 I7 I8 I9 unless the original lie is back.\n";
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
log("Fixing 2026-08-19 findings in parallel streams");

let common = "";
common += "Repo root: " + root + "\n";
common += "Audit source of truth: " + audit_doc + " — read YOUR IDs before editing.\n";
common += "Package: PayKernel monorepo (Bun + TypeScript). Do NOT commit. Do NOT push.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; add/flip unit tests that lock the lie;\n";
common += "re-read changed regions; prefer existing PaymentStatus values;\n";
common += "fail-closed on incomplete money; never convert uncertain mutation outcomes into a retryable failure that clears a fence;\n";
common += "ALWAYS publish currency together with major-unit amount fields;\n";
common += "Do not undo 2026-08-18 C1 (unexpanded PI + amount_received>0 is paid when no refund evidence).\n";
common += "Run bun test on touched test files when possible. Skip items critic proves already fixed.\n";
common += "OWN FILES ONLY — do not edit other streams files.\n";
common += "Return JSON {ok, files_changed, summary, notes, fixed_ids}.\n";

let p_a = "";
p_a += common;
p_a += "STREAM A — STRIPE + BASE HOOKS. OWN:\n";
p_a += "- " + root + "/packages/core/src/gateways/base.gateway.ts\n";
p_a += "- " + root + "/packages/core/src/gateways/base.gateway.test.ts\n";
p_a += "- " + root + "/packages/core/src/gateways/stripe/**\n";
p_a += "- " + root + "/packages/core/docs/stripe.md\n";
p_a += "Do NOT edit paymob, paypal, moyasar, webhook-event-map, client.ts, webhooks package, stores.\n";
p_a += "FIX S19-CKO-TIMEOUT (BLOCKING): add createCheckoutSession to isPostSubmitMoneyMutation.\n";
p_a += "tryIndeterminateFromNetworkError must return a checkout-shaped indeterminate (reconciliationRequired: true),\n";
p_a += "not applyIndeterminatePaymentOutcome (wrong shape). getCheckoutSession stays throwing.\n";
p_a += "Tests: mutating checkout POST timeout is not a retryable failed-create / not success:true.\n";
p_a += "FIX S19-STRIPE-LATE-REFUND (BLOCKING): honor charges.data / expanded charge refunds on PI.succeeded.\n";
p_a += "Do NOT undo C1: string latest_charge + amount_received>0 + no refund snapshot stays paid.\n";
p_a += "Document apps must not last-write PI.succeeded over charge.refunded.\n";
p_a += "FIX S19-CKO-AMOUNT / S19-CKO-GET: when payment_intent is expanded, publish amount_received and rematch refunds.\n";
p_a += "getCheckoutSession must not ignore the expanded PI.\n";
p_a += "FIX S19-STRIPE-CHARGE-SWALLOW: propagate 401/5xx on GET /charges/{id}; processing only if charge unobservable.\n";
p_a += "FIX S19-STRIPE-DISPUTE: charge.dispute.* must not map paid envelopes to generic pending; prefer unmapped/dispute status.\n";
p_a += "FIX S19-EPHEMERAL-KEY (Stripe only): capture/refund/void require caller idempotencyKey OR warn and keep ephemeral only for withRetry.\n";
p_a += "Prefer fail-closed on capture/refund/void without caller key if you can flip tests. createPayment may keep ephemeral + warn.\n";

let p_b = "";
p_b += common;
p_b += "STREAM B — PAYMOB GATEWAY. OWN:\n";
p_b += "- " + root + "/packages/core/src/gateways/paymob/**\n";
p_b += "- " + root + "/packages/core/docs/paymob.md\n";
p_b += "Do NOT edit webhook-event-map.ts (stream C). Do NOT edit webhooks package.\n";
p_b += "FIX S19-PAYMOB-JSON (BLOCKING): parseJson must NOT return {} on invalid JSON.\n";
p_b += "GET inquiry invalid/empty 200 throws GatewayApiError / unavailable — not failed/declined.\n";
p_b += "Mutations keep requireMutation* indeterminate on HTTP 200 missing success/id.\n";
p_b += "Add test: empty or non-JSON 200 inquiry is not outcome declined.\n";
p_b += "FIX S19-PAYMOB-REDIR-STATUS (BLOCKING): redirect envelope status must be processing, not paid.\n";
p_b += "Flip tests that lock status===paid on TRANSACTION_RESPONSE.\n";
p_b += "FIX S19-PAYMOB-REFUND-UNPAID (BLOCKING): refuse refund/capture unless inquiry is captured/paid or captured_amount>0.\n";
p_b += "Pending/failed sales throw InvalidRequestError before POST. Add tests (fetchCalls.length===0).\n";
p_b += "FIX S19-PAYMOB-LEGACY-ID: do not set gatewayId to the ecommerce order id. Keep orderId on nextAction/orderId field.\n";
p_b += "assertPaymobTransactionId still requires numeric txn id from webhook obj.id. Update docs.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — CORE MAPPER. OWN:\n";
p_c += "- " + root + "/packages/core/src/types/webhook-event-map.ts\n";
p_c += "- " + root + "/packages/core/src/types/payment-event.test.ts if mapper tests live there\n";
p_c += "Do NOT edit gateways or client.ts.\n";
p_c += "FIX S19-MAP-REFUND-PENDING (BLOCKING): in mapPaymobFromFlags, flags.pending / status pending|processing|refund_pending\n";
p_c += "rank BEFORE hasAmountRefund / isRefunded / isRefund+success.\n";
p_c += "mapPaymobStatusOnly: refund_pending -> refund.pending; refund_failed -> refund.failed.\n";
p_c += "Add test: flags pending+success+isRefund, no status -> payment.processing not refund.completed.\n";
p_c += "Add test: amounts.refundedAmountCents>0 + flags.pending -> payment.processing or refund.pending, not refund.completed.\n";

let p_d = "";
p_d += common;
p_d += "STREAM D — WEBHOOKS ENGINE. OWN:\n";
p_d += "- " + root + "/packages/webhooks/src/**\n";
p_d += "- " + root + "/packages/webhooks/docs/** if needed\n";
p_d += "Do NOT edit examples. Do NOT edit store adapters.\n";
p_d += "FIX S19-WH-HASH-TOCTOU (BLOCKING): processRetryable must not claim with a hash older than the row at claim time.\n";
p_d += "If get hash != listed hash, skip (already done). ALSO: between get and claim, idle supersede can roll back.\n";
p_d += "Claim with the listed hash and skip acquire if store hash moved forward, OR re-read immediately before claim and skip on mismatch,\n";
p_d += "OR make claim refuse supersede when caller hash is stale (compare inside atomic claim).\n";
p_d += "Add a test that listed hash-a + idle hash-b at claim time does not rewrite to hash-a.\n";

let p_e = "";
p_e += common;
p_e += "STREAM E — RECONCILIATION SCHEDULER. OWN:\n";
p_e += "- " + root + "/packages/reconciliation/src/scheduler.ts\n";
p_e += "- " + root + "/packages/reconciliation/src/scheduler.test.ts\n";
p_e += "- " + root + "/packages/reconciliation/README.md\n";
p_e += "Do NOT edit store adapters (stream F). Do NOT edit webhooks.\n";
p_e += "FIX S19-CLAIM-DUE: claimDue must not Promise.all N leases then return them for serial work.\n";
p_e += "Claim one-at-a-time, or make claimDue a thin discovery and document processDue as the only production worker.\n";
p_e += "Prefer one-at-a-time. Update README that shows the bulk-claim loop.\n";
p_e += "FIX S19-RECON-HB: while processDue awaits the handler, auto-renew on leaseMs/3 (webhook parity).\n";
p_e += "If renew is lease_lost, stop treating the run as owner. Do not park retry_later to manual_review via hangByKey budget.\n";
p_e += "Add tests: claimDue does not hold N live leases across a slow second claim; hang after expiry does not park retry_later.\n";

let p_f = "";
p_f += common;
p_f += "STREAM F — STORE LEASE CLOCK. OWN:\n";
p_f += "- " + root + "/packages/store-postgres/src/stores/**\n";
p_f += "- " + root + "/packages/store-sqlite/src/stores/**\n";
p_f += "- " + root + "/packages/store-turso/src/stores/**\n";
p_f += "- " + root + "/packages/store-d1/src/stores/**\n";
p_f += "- " + root + "/packages/store-redis/src/scripts/** GET/list soft-release only\n";
p_f += "- " + root + "/packages/store-durable-objects/src/stores/** listDue now wipe\n";
p_f += "- matching unit tests under those packages\n";
p_f += "Do NOT edit sql-foundation claim UPSERT templates unless required for get() wipe.\n";
p_f += "Do NOT edit reconciliation scheduler (stream E).\n";
p_f += "FIX S19-CLOCK-LEASE: get() must NOT UPDATE/clear lease_token using a caller or injected now that can be ahead of the issuer.\n";
p_f += "Remove mutative soft-release from get(), or only soft-release on list/claim using the store clock that issued the lease.\n";
p_f += "DO recon listDue must not wipe isolate-issued leases with Worker-supplied now.\n";
p_f += "Keep FakeClock: do NOT switch SQL comparisons to NOW() if that breaks injected clocks.\n";
p_f += "Add a test: get() on a still-valid lease does not null lease_token.\n";
p_f += "Optional nit S19-SQLITE-ENGINES: document node 22.5+ for /node subpath in package.json or README only if you touch that package README.\n";

let p_g = "";
p_g += common;
p_g += "STREAM G — FINGERPRINT + CORE SAMPLES. OWN:\n";
p_g += "- " + root + "/packages/core/src/utils/idempotency.ts\n";
p_g += "- " + root + "/packages/core/src/utils/utils.test.ts and money/idempotency tests that assert fingerprint strings\n";
p_g += "- " + root + "/packages/core/src/index.ts (JSDoc sample only)\n";
p_g += "- " + root + "/packages/core/README.md webhook sample\n";
p_g += "- " + root + "/packages/core/src/runtime/crypto-portable.ts if you do S19-SHA256-LEN\n";
p_g += "- " + root + "/packages/reconciliation/src/sanitize.ts if you do S19-RECON-PAN (recon sanitize only; not webhooks)\n";
p_g += "Do NOT edit gateways, stores, examples, webhooks engine.\n";
p_g += "FIX S19-FINGERPRINT: persisted fingerprint must be a digest (sha256Hex of stable stringify after redact + strip AbortSignal).\n";
p_g += "Economically identical params must still collide. Update tests that compare stored fingerprint to raw stringify.\n";
p_g += "FIX S19-DOCS-SUCCESS: index.ts JSDoc and core README must fulfill only on paid / isPaidOutcome + inbox. Never if(result.success).\n";
p_g += "Optional: S19-SHA256-LEN write high 32 bits of SHA-256 length. S19-RECON-PAN add 13-19 digit PAN redaction.\n";

let p_h = "";
p_h += common;
p_h += "STREAM H — EXAMPLES. OWN:\n";
p_h += "- " + root + "/examples/**\n";
p_h += "Do NOT edit packages/*.\n";
p_h += "FIX S19-EXAMPLE-BIND: findOrderForEvent fulfill only when gatewayPaymentId matches stored id (or bind webhook PI first then match).\n";
p_h += "fulfill() should record gatewayPaymentId from the webhook when missing.\n";
p_h += "FIX S19-EXAMPLE-RECON: POST /internal/reconcile must be labeled test-only and/or rejected without a test hook flag — same honesty as provider-paid.\n";
p_h += "FIX S19-EXAMPLE-AMOUNT: snapshotForOrder must use getPayment money, not order.amount. Do not name client JSON trustedAmount; example should use server amount.\n";
p_h += "Add/flip tests: Stripe fixture metadata cannot fulfill a mock-charged order with a different PI; recon route comments say do not deploy.\n";

let p_j = "";
p_j += common;
p_j += "STREAM J — AUDIT BOOKKEEPING. OWN:\n";
p_j += "- " + root + "/docs/audits/**\n";
p_j += "Do NOT edit production src.\n";
p_j += "Write " + root + "/docs/audits/session-audit-r7-fix-pass-2026-08-19.md with stream ownership and IDs.\n";
p_j += "List blocking: S19-CKO-TIMEOUT S19-PAYMOB-JSON S19-PAYMOB-REDIR-STATUS S19-PAYMOB-REFUND-UNPAID S19-MAP-REFUND-PENDING S19-WH-HASH-TOCTOU S19-STRIPE-LATE-REFUND.\n";
p_j += "Do not claim gate pass here.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:stripe", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:paymob", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:mapper", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:webhooks", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:recon", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:stores", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:fingerprint-docs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_h, label: "fix:examples", capability_mode: "all", output_schema: implement_schema },
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
p_int += "Integrate paykernel-session-audit-r7-fix-gate streams in " + root + ". Do NOT commit.\n";
p_int += "1) git status / diff — fix any broken TS from parallel streams.\n";
p_int += "2) bun run typecheck — fix all errors from our changes.\n";
p_int += "3) bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples until green.\n";
p_int += "4) Cross-check invariants from " + audit_doc + ":\n";
p_int += "   - S19-CKO-TIMEOUT: createCheckoutSession is post-submit money mutation / indeterminate on afterProviderSubmit\n";
p_int += "   - S19-PAYMOB-JSON: parseJson does not return {} ; inquiry empty 200 is not declined\n";
p_int += "   - S19-PAYMOB-REDIR-STATUS: redirect status is not paid\n";
p_int += "   - S19-PAYMOB-REFUND-UNPAID: failed sale refund does not POST\n";
p_int += "   - S19-MAP-REFUND-PENDING: pending ranks before refund.completed\n";
p_int += "   - S19-WH-HASH-TOCTOU: processRetryable cannot supersede backwards\n";
p_int += "   - C1 still holds: unexpanded PI + amount_received>0 is paid without refund snapshot\n";
p_int += "5) Update " + root + "/docs/audits/session-audit-r7-fix-pass-2026-08-19.md with what landed vs remaining.\n";
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
p_ver += "Verify session-audit-r7 fixes in " + root + " with command evidence and file reads.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test packages/core packages/webhooks packages/reconciliation packages/store-postgres packages/store-redis packages/store-sqlite packages/store-durable-objects examples\n";
p_ver += "3) Invariant greps/reads (must hold):\n";
p_ver += "   - S19-CKO-TIMEOUT: isPostSubmitMoneyMutation includes createCheckoutSession\n";
p_ver += "   - S19-PAYMOB-JSON: parseJson does not catch-return {}\n";
p_ver += "   - S19-PAYMOB-REDIR-STATUS: redirect status processing\n";
p_ver += "   - S19-MAP-REFUND-PENDING: pending before refund arms\n";
p_ver += "   - S19-WH-HASH-TOCTOU: no stale-hash supersede on processRetryable\n";
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

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarially gate PayKernel session-audit-r7-fix-gate in " + root + ".\n";
p_gate += "Skeptical: read actual code with read_file/grep. Do NOT trust implement summaries.\n";
p_gate += "BLOCKING if still broken:\n";
p_gate += "S19-CKO-TIMEOUT: createCheckoutSession afterProviderSubmit still thrown as failed-create\n";
p_gate += "S19-PAYMOB-JSON: parseJson still returns {}; inquiry empty 200 still declined\n";
p_gate += "S19-PAYMOB-REDIR-STATUS: redirect status still paid\n";
p_gate += "S19-PAYMOB-REFUND-UNPAID: failed/pending sale still POSTs refund/capture\n";
p_gate += "S19-MAP-REFUND-PENDING: flags pending+refund still refund.completed\n";
p_gate += "S19-WH-HASH-TOCTOU: processRetryable can still supersede backwards\n";
p_gate += "S19-STRIPE-LATE-REFUND: observable charge refunds still ignored (do not fail C1)\n";
p_gate += "P0: typecheck or tests red (ignore known isolated WAL flake / live-Redis skip).\n";
p_gate += "Should-fix leftovers as non_blocking unless they create money/fulfillment lies.\n";
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
    p_fix += "Fix remaining BLOCKING session-audit-r7 issues in " + root + ".\n";
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
    p_fix += "Priority: S19-CKO-TIMEOUT S19-PAYMOB-JSON S19-PAYMOB-REDIR-STATUS S19-PAYMOB-REFUND-UNPAID S19-MAP-REFUND-PENDING S19-WH-HASH-TOCTOU S19-STRIPE-LATE-REFUND, then typecheck/tests green.\n";
    p_fix += "Read " + audit_doc + " for evidence paths. Fix surgically. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: rem_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify " + root + " after remediation. Run bun run typecheck and bun test core+webhooks+recon+store-postgres+store-redis+store-sqlite+store-durable-objects+examples.\n";
    p_ver2 += "Re-check blocking S19 IDs from " + audit_doc + ".\n";
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
p_rep += "Write fix result report to " + root + "/docs/audits/session-audit-r7-fix-result-2026-08-19.md\n";
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

log("paykernel-session-audit-r7-fix-gate complete final_pass=" + final_pass.to_string());

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
