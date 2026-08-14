let meta = #{
    name: "phase-6-10-fix-gate",
    description: "Critic, fix, verify, and adversarially gate Phase 6-10 review findings",
    phases: [
        #{ title: "Critic", detail: "confirm each finding still present" },
        #{ title: "Fix", detail: "nine non-overlapping implementation streams" },
        #{ title: "Verify", detail: "typecheck plus targeted tests" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "write gate report" },
    ],
    when_to_use: "After a Phase 6-10 review; fix outcomes, webhook mapping, runtime, stores, inbox ACK then gate",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "fixed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 24 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let rem_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 24 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 24 },
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

fn safe_summary(r) {
    if r == () { return "no-result"; }
    if !r.success { return "failed"; }
    if r.output == () { return "empty-output"; }
    if r.output.summary == () { return "ok"; }
    r.output.summary
}

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Confirming Phase 6-10 findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "P610-MAP-1: Moyasar unknown type + status paid dual-writes payment.succeeded (webhook-event-map mapMoyasarEventType fallback).\n";
p_c += "P610-MAP-2: Paymob unknown type still runs mapPaymobTransactionSignals and can dual-write payment.succeeded.\n";
p_c += "P610-IND-1: Built-in gateways never applyOutcomeToGatewayResult(..., indeterminate); post-submit timeout/5xx throw NetworkError.\n";
p_c += "P610-ACK-1: Inline engine can emit scheduled_for_retry (not_available after fail backoff).\n";
p_c += "P610-ACK-2: ackAfterClaim returns parked when store.fail lease_lost (park not persisted).\n";
p_c += "P610-ACK-3: bestEffortRecordFailAfterLeaseLost catch returns terminal=forceDeadLetter without persist.\n";
p_c += "P610-PP-1: PayPal REVERSED maps to outcome succeeded via mapPayPalOutcome fallthrough.\n";
p_c += "P610-PP-2: PayPal partially_captured dual-writes outcome succeeded.\n";
p_c += "P610-INF-1: isSettledSuccessStatus includes partially_captured so infer upgrades open money.\n";
p_c += "P610-INF-2: inferOperationOutcome maps success:false + pending to failed.\n";
p_c += "P610-MOY-1: Moyasar createPayment JSDoc says fulfill on authorized.\n";
p_c += "P610-MOY-2: Moyasar missing/NaN captured coerced to 0 then provider paid stays paid.\n";
p_c += "P610-MOY-3: Moyasar strips secret_token then hashes (key absence vs REDACTED).\n";
p_c += "P610-HASH-1: hashWebhookPayload/redactDeep does not redact secrets inside JSON strings.\n";
p_c += "P610-HASH-2: Uint8Array/Buffer hash is length marker only.\n";
p_c += "P610-SAFE-1: client.handleWebhook attaches only if event.event === undefined; no isPaymentEvent/schemaVersion/demotes.\n";
p_c += "P610-PP-3: PayPal PAYMENT.REFUND.COMPLETED dual-writes refund.completed while domain is refund_completed.\n";
p_c += "P610-DOC-1: webhook-events.md says Paymob HMAC refunds dual-write refund.completed; code is refund.pending.\n";
p_c += "P610-RED-1: WEBHOOK_PAYLOAD_SECRET_KEYS misses camelCase clientSecret.\n";
p_c += "P610-CLK-1: PayPal tokenExpiry written from this.clock compared to new Date().\n";
p_c += "P610-ABT-1: createTimeoutSignal AbortSignal.timeout clear() is a no-op.\n";
p_c += "P610-ABT-2: combineAbortSignals polyfill never removes listeners.\n";
p_c += "P610-ABT-3: extractAbortSignal uses instanceof AbortSignal.\n";
p_c += "P610-ABT-4: PayPal/Moyasar/Paymob clear timeout before response body is read.\n";
p_c += "P610-CLK-2: Paymob/Moyasar idempotency TTL uses Date.now not this.clock.\n";
p_c += "P610-STO-1: testkit memory fail() calls releaseExpiredLease before token check.\n";
p_c += "P610-STO-2: store-contracts FailWebhookInput still says expired fail is lease_lost (vs WEBHOOKS-2).\n";
p_c += "P610-STO-3: isStoreLeaseLostError differs across store-contracts / webhooks / reconciliation.\n";
p_c += "P610-SNAP-1: durable_retry snapshots input.event via redact only; can persist WebhookEvent.rawPayload.\n";
p_c += "P610-CLK-3: Paymob pruneExpiredIdempotencyEntries deletes unknown/in_progress fences by age.\n";
p_c += "Return confirmed[] as ID strings, already_fixed[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:phase-6-10",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Nine non-overlapping fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style. Do not weaken tests. Prefer fail-closed money and no silent webhook ACK.\n";

let p_a = rules;
p_a += "STREAM A OUTCOMES. Files ONLY:\n";
p_a += "packages/core/src/types/operation-result.ts\n";
p_a += "packages/core/src/types/operation-result.test.ts\n";
p_a += "packages/core/src/types/operation-results.acceptance.test.ts\n";
p_a += "packages/core/src/types/domain-status.ts\n";
p_a += "packages/core/docs/operation-results.md\n";
p_a += "FIX P610-INF-1: remove partially_captured from isSettledSuccessStatus. Bare {success:true,status:partially_captured} must infer requires_action (open money). Keep paid/authorized/refunded/partially_refunded as settled-success for outcome only; isPaidOutcome stays paid-only.\n";
p_a += "FIX P610-INF-2: success:false + pending/processing/approved must NOT infer failed. Infer indeterminate (or requires_action if you can prove no mutation was submitted). Prefer indeterminate + tests. Update the test that currently expects failed for success:false+pending.\n";
p_a += "Do not attach reconciliationRequired unless outcome is indeterminate. After applyOutcome, stored outcome should match infer (no dual-write lie).\n";
p_a += "Do not edit gateway files.\n";

let p_b = rules;
p_b += "STREAM B PAYPAL. Files ONLY:\n";
p_b += "packages/core/src/gateways/paypal/paypal.gateway.ts\n";
p_b += "packages/core/src/gateways/paypal/paypal.gateway.test.ts\n";
p_b += "FIX P610-PP-1: mapPayPalOutcome(reversed) must NOT be succeeded. Use failed (or a non-success arm). Test outcome !== succeeded and isPaidOutcome false.\n";
p_b += "FIX P610-PP-2: partially_captured must dual-write requires_action not succeeded. Update tests that lock succeeded.\n";
p_b += "FIX P610-PP-3: PAYMENT.REFUND.COMPLETED / incomplete refund_completed must dual-write refund.pending (align Stripe/Moyasar/Paymob). Keep provider.eventType native.\n";
p_b += "FIX P610-CLK-1: compare tokenExpiry with this.clock.nowMs() not new Date().\n";
p_b += "FIX P610-ABT-4 for PayPal only: keep timeout armed until response body is consumed (Stripe shape). Thread caller AbortSignal into getAccessToken/fetchAccessToken if cheap.\n";
p_b += "Do not edit stripe/moyasar/paymob files.\n";

let p_c = rules;
p_c += "STREAM C MOYASAR. Files ONLY:\n";
p_c += "packages/core/src/gateways/moyasar/moyasar.gateway.ts\n";
p_c += "packages/core/src/gateways/moyasar/moyasar.gateway.test.ts\n";
p_c += "FIX P610-MOY-1: JSDoc must say fulfill only on status paid / isPaidOutcome. Delete authorized as fulfillment.\n";
p_c += "FIX P610-MOY-2: paid/captured family without a finite captured total must fail-close to processing (Stripe/Paymob parity). Test.\n";
p_c += "FIX P610-MOY-3: do not strip secret_token before hash. Hash via hashWebhookPayload (redacts in place). rawPayload may still omit the secret for request-local safety AFTER hashing, or keep key as [REDACTED]. Digest must match hashWebhookPayload(redacted-with-key).\n";
p_c += "FIX P610-CLK-2 Moyasar only: createdAt/cache TTL use this.clock.nowMs() not Date.now().\n";
p_c += "FIX P610-ABT-4 Moyasar only: keep timeout until body consumed.\n";
p_c += "Unknown envelope types: do not rely on status fallback for dual-write (mapper stream owns webhook-event-map). Gateway may refuse card_auth_* as today. Add test that a free-form type with paid status is NOT payment.succeeded once mapper is fixed; if mapper not yet merged, still avoid inventing succeeded in any gateway-local remapping.\n";
p_c += "Do not edit webhook-event-map.ts.\n";

let p_d = rules;
p_d += "STREAM D EVENTS/HASH. Files ONLY:\n";
p_d += "packages/core/src/types/webhook-event-map.ts\n";
p_d += "packages/core/src/types/payment-event.ts\n";
p_d += "packages/core/src/types/payment-event.test.ts\n";
p_d += "packages/core/src/webhook-events.acceptance.test.ts\n";
p_d += "packages/core/docs/webhook-events.md\n";
p_d += "FIX P610-MAP-1: mapMoyasarEventType — only MOYASAR_EVENT_TYPE_MAP keys. Unknown type -> provider.unmapped. Do NOT status-fallback to payment.succeeded. Test unknown type + paid.\n";
p_d += "FIX P610-MAP-2: mapPaymobEventType — only TRANSACTION / TRANSACTION_RESPONSE / TOKEN. Unknown -> provider.unmapped even if flags.success. Test.\n";
p_d += "FIX P610-HASH-1: redactDeep / hashWebhookPayload must JSON-parse strings and redact (same as prepareEncryptPlaintext).\n";
p_d += "FIX P610-HASH-2: hash actual Uint8Array/Buffer bytes, not length markers. Keep WEBHOOKS-2 honesty: string vs object digests may still differ AFTER redaction.\n";
p_d += "FIX P610-RED-1: add camelCase aliases (clientSecret, secretToken, webhookSecret, accessToken) to WEBHOOK_PAYLOAD_SECRET_KEYS. stripRawFromPaymentEvent must also strip nested nextAction.clientSecret.\n";
p_d += "FIX P610-DOC-1: webhook-events.md Paymob HMAC refunds are refund.pending not refund.completed.\n";
p_d += "Do not edit gateway or client files.\n";

let p_e = rules;
p_e += "STREAM E STRIPE+CLIENT. Files ONLY:\n";
p_e += "packages/core/src/client.ts\n";
p_e += "packages/core/src/client.test.ts\n";
p_e += "packages/core/src/gateways/stripe/stripe.gateway.ts\n";
p_e += "packages/core/src/gateways/stripe/stripe.gateway.test.ts\n";
p_e += "FIX P610-SAFE-1: handleWebhook safety-net must rebuild dual-write when event.event is missing OR fails isPaymentEvent / schemaVersion !== 1. Apply the same incomplete-money / incomplete-refund demotes used by Stripe gateway when the rebuilt event is stripe-like (status processing/partially_captured + payment_intent.succeeded, refund_completed). Prefer calling attachPaymentEvent then existing Stripe demote helpers if you can do so without importing a circular mess; otherwise duplicate the small demote in client only for the safety-net path using public helpers.\n";
p_e += "Stripe $0 checkout: payment-mode no_payment_required may stay paid ONLY when amount_total is 0 (or unset+mode payment documented). If amount_total > 0, do not invent paid. Add/adjust tests.\n";
p_e += "Do not edit paypal/moyasar/paymob/webhooks.\n";

let p_f = rules;
p_f += "STREAM F PAYMOB. Files ONLY:\n";
p_f += "packages/core/src/gateways/paymob/paymob.gateway.ts\n";
p_f += "packages/core/src/gateways/paymob/paymob.gateway.test.ts\n";
p_f += "FIX P610-CLK-2 Paymob: idempotency createdAt/expiresAt/prune and legacy token expiry comparisons that are cache TTL (not JWT exp vs wall) must use this.clock.nowMs().\n";
p_f += "FIX P610-CLK-3: pruneExpiredIdempotencyEntries must NEVER delete status in_progress or unknown fences. Test.\n";
p_f += "FIX P610-ABT-4 Paymob: keep timeout until body consumed.\n";
p_f += "Missing type must not default to TRANSACTION if that invents fulfillment (prefer unmapped / require explicit type). Do not edit webhook-event-map.ts.\n";
p_f += "Do not evict unknown fences under FIFO pressure either if that path still exists.\n";

let p_g = rules;
p_g += "STREAM G INBOX ENGINE. Files ONLY under packages/webhooks/src/ except memory-store.ts and store.ts:\n";
p_g += "packages/webhooks/src/engine.ts\n";
p_g += "packages/webhooks/src/engine.test.ts\n";
p_g += "packages/webhooks/src/engine.modes.test.ts\n";
p_g += "packages/webhooks/src/engine.concurrency.test.ts\n";
p_g += "packages/webhooks/src/engine.crash.test.ts\n";
p_g += "packages/webhooks/src/types.ts\n";
p_g += "packages/webhooks/src/sanitize.ts\n";
p_g += "packages/webhooks/README.md\n";
p_g += "packages/webhooks/docs/webhook-inbox.md\n";
p_g += "FIX P610-ACK-1: inline must NEVER emit scheduled_for_retry. fail with retryAfterMs 0. Map not_available on inline to handler_failed retryable true. Test: inline throw then immediate redelivery is not scheduled_for_retry.\n";
p_g += "FIX P610-ACK-2: ackAfterClaim return parked ONLY if store.fail(restoreAttempt) succeeds. On lease_lost return already_processing or handler_failed retryable true. Test.\n";
p_g += "FIX P610-ACK-3: bestEffort catch must NOT set terminal true unless fail/dead_letter actually applied or claim kind is already_completed/duplicate_failed. Post-reclaim fail throw -> retryable handler_failed. Test.\n";
p_g += "FIX P610-SNAP-1: durable_retry must not persist rawPayload. Prefer toPersistedPaymentEventEnvelope or refuse event that still has rawPayload/headers. Sanitize {ok:false}.reason.\n";
p_g += "Narrow permanent 4xx: 408/409/425 stay retryable.\n";
p_g += "Do not edit packages/webhooks/src/store.ts or memory-store.ts (stream H).\n";

let p_h = rules;
p_h += "STREAM H STORES. Files ONLY:\n";
p_h += "packages/store-contracts/src/contracts.ts\n";
p_h += "packages/testkit/src/memory/memory-stores.ts\n";
p_h += "packages/testkit/src/memory/memory-stores.test.ts\n";
p_h += "packages/testkit/src/storage/webhook-inbox-conformance.ts\n";
p_h += "packages/testkit/docs/store-contracts.md\n";
p_h += "packages/webhooks/src/store.ts\n";
p_h += "packages/webhooks/src/memory-store.ts\n";
p_h += "packages/sql-foundation/src/claims/algorithm.ts\n";
p_h += "FIX P610-STO-1: testkit memory fail() must NOT releaseExpiredLease first. Matching token + claimed succeeds after expiry (WEBHOOKS-2). Soft-release only on get/listRetryable. Add conformance: claim, advance past lease, fail records pending/dead_letter.\n";
p_h += "FIX P610-STO-2: store-contracts FailWebhookInput / comments must say matching token + claimed succeeds even after expiry; complete/renew still require active lease.\n";
p_h += "FIX P610-STO-3: unify isStoreLeaseLostError comments: adapters must throw name StoreLeaseLostError. Do not match bare {code:lease_lost} as fencing in webhook engine (keep WEBHOOKS-6). Update testkit docs source-of-truth to @paykernel/store-contracts.\n";
p_h += "Idempotency decideLeaseMutation: classify indeterminate (and completed) BEFORE fingerprint_conflict.\n";
p_h += "maxEntries must not evict claimed/reserved with active lease (skip or refuse).\n";
p_h += "Do not edit engine.ts.\n";

let p_i = rules;
p_i += "STREAM I RUNTIME. Files ONLY:\n";
p_i += "packages/core/src/runtime/abort.ts\n";
p_i += "packages/core/src/runtime/abort.test.ts\n";
p_i += "packages/core/docs/runtime.md\n";
p_i += "scripts/check-runtime-portability.ts\n";
p_i += "scripts/check-runtime-portability.test.ts\n";
p_i += "FIX P610-ABT-1: do NOT use AbortSignal.timeout. Always AbortController+setTimeout so clear() cancels. unref when present.\n";
p_i += "FIX P610-ABT-2: polyfill combineAbortSignals must remove listeners when any input aborts or expose that callers rely on once:true; add abort listener cleanup if you return a combined signal (track and remove on abort).\n";
p_i += "FIX P610-ABT-3: extractAbortSignal duck-type (aborted boolean + addEventListener function), not instanceof only.\n";
p_i += "runtime.md: delete Math.random UUID fallback; document CORE-3 throw + inject.\n";
p_i += "Portability scanner: also scan packages/webhooks and packages/store-contracts production src+dist for node: / bun: / cloudflare:.\n";
p_i += "Do not edit gateway HTTP helpers (other streams own P610-ABT-4).\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:outcomes", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:paypal", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_c, label: "fix:moyasar", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:events", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_e, label: "fix:stripe-client", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_f, label: "fix:paymob", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_g, label: "fix:inbox", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_h, label: "fix:stores", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_i, label: "fix:runtime", capability_mode: "all", output_schema: fix_schema },
]);

let fi = 0;
for f in fixes {
    log("Fix stream " + fi.to_string() + ": " + safe_summary(f));
    fi += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Typecheck and targeted tests");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root:\n";
p_v += "1) bun run typecheck\n";
p_v += "2) bun test packages/core/src/types/operation-result.test.ts packages/core/src/types/operation-results.acceptance.test.ts packages/core/src/types/payment-event.test.ts packages/core/src/webhook-events.acceptance.test.ts packages/core/src/runtime/abort.test.ts packages/core/src/gateways/paypal/paypal.gateway.test.ts packages/core/src/gateways/moyasar/moyasar.gateway.test.ts packages/core/src/gateways/stripe/stripe.gateway.test.ts packages/core/src/gateways/paymob/paymob.gateway.test.ts packages/core/src/client.test.ts packages/webhooks packages/testkit/src/memory packages/store-contracts packages/sql-foundation\n";
p_v += "3) bun run check:runtime-portability if the script exists.\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass.\n";

let verify = agent(p_v, #{
    label: "verify:tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of blocking fixes");

let p_g2 = "";
p_g2 += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g2 += "Fail closed. Use read_file/grep. pass=true only if ALL blockers are gone with evidence.\n";
p_g2 += "Blockers:\n";
p_g2 += "P610-MAP-1/2 unknown+paid is not payment.succeeded\n";
p_g2 += "P610-ACK-1/2/3 no silent ACK (inline never scheduled_for_retry; parked only after persist; no fake terminal)\n";
p_g2 += "P610-PP-1/2 reversed and partial not outcome succeeded\n";
p_g2 += "P610-INF-1 infer does not upgrade partially_captured to succeeded\n";
p_g2 += "P610-STO-1 testkit fail after expiry accepts matching token\n";
p_g2 += "P610-HASH-1 JSON string secrets redacted before hash\n";
p_g2 += "P610-MOY-1 JSDoc does not tell merchants to fulfill on authorized\n";
p_g2 += "P610-CLK-1 PayPal token uses injected clock\n";
p_g2 += "Return {pass, blocking, non_blocking, summary}.\n";

let gate = agent(p_g2, #{
    label: "gate:adversarial",
    capability_mode: "read-only",
    output_schema: gate_schema,
});
log("Gate: " + safe_summary(gate));

let gate_pass = false;
if gate != () && gate.success && gate.output != () && gate.output.pass == true {
    gate_pass = true;
}

// ─── Remediate ───────────────────────────────────────────────────
phase("Remediate");
if !gate_pass {
    log("Gate failed; remediating blockers");
    let p_r = "";
    p_r += "Repo: " + root + "\n";
    p_r += "Gate did not pass. Read remaining blockers and fix them. Do not commit.\n";
    if gate != () && gate.success && gate.output != () && gate.output.blocking != () {
        p_r += "Blockers: " + json_encode(gate.output.blocking) + "\n";
    }
    if verify != () && verify.success && verify.output != () && verify.output.failures != () {
        p_r += "Test failures: " + json_encode(verify.output.failures) + "\n";
    }
    p_r += "Priority: MAP-1/2, ACK-1/2/3, PP-1/2, INF-1, STO-1, HASH-1, then typecheck/tests.\n";
    p_r += "Re-run failing bun tests after edits. Return {ok, fixed, remaining, summary}.\n";
    let rem = agent(p_r, #{
        label: "remediate:blockers",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    log("Remediate: " + safe_summary(rem));
} else {
    log("Gate passed; skip remediate");
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
let p_rep = "";
p_rep += "Write " + root + "/packages/core/docs/baseline/phase-6-10-fix-gate-report.md\n";
p_rep += "Summarize critic, nine fix streams, verify commands, gate verdict, remaining nits.\n";
p_rep += "Cite file paths. Do not invent fixes not in the tree. Return {ok, report_path, summary}.\n";
let report = agent(p_rep, #{
    label: "report:gate",
    capability_mode: "all",
    output_schema: report_schema,
});
log("Report: " + safe_summary(report));

let report_path = "";
if report != () && report.success && report.output != () && report.output.report_path != () {
    report_path = report.output.report_path;
}

complete(#{
    summary: "Phase 6-10 critic/fix/verify/gate finished",
    gate_pass: gate_pass,
    report_path: report_path,
    critic: safe_summary(critic),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
});
