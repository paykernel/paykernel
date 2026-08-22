let meta = #{
    name: "phase-23-tap-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every Tap gateway review finding (redirect.url, udf1 paymentId, refund post.url, Fawry IN PROGRESS, void retry, capture body, 1151, types)",
    phases: [
        #{ title: "Critic", detail: "reconfirm every TAP-* ID against current gateway-tap code" },
        #{ title: "Fix", detail: "three non-overlapping streams for confirmed findings" },
        #{ title: "Verify", detail: "typecheck plus gateway-tap tests and invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "scratch gate report" },
    ],
    when_to_use: "After the @paykernel/gateway-tap deep review; critic then fix then verify then gate redirect.url, webhook paymentId, refund IPN, Fawry status, void retry, capture body",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "skipped": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "fixed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
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
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let rem_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "report_markdown": #{ "type": "string" },
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
log("Confirming Tap gateway review findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep on packages/gateway-tap/src and packages/gateway-tap/docs. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "Tap official API facts (do not invent opposite):\n";
p_c += "- transaction.url is the hosted checkout / 3DS URL. redirect.url is the merchant callback, present on CAPTURED and AUTHORIZED objects.\n";
p_c += "- metadata.udf1 is arbitrary merchant UDF, not a payment id. Create sends orderId as reference.order.\n";
p_c += "- Refunds have post.url for IPN. Idempotency (reference.idempotent) is documented for charges, authorize, refunds — NOT void. Void OpenAPI has no request body.\n";
p_c += "- Charge status IN PROGRESS is used for Fawry (src_eg.fawry). Error 1151 is Gateway timed out. 2101 server unavailable. 9999 internal server error.\n";
p_c += "BLOCKING:\n";
p_c += "TAP-REDIRECT-URL: gateway.ts redirectUrl() falls back to obj.redirect.url after transaction.url. Real CAPTURED/AUTHORIZED payloads have redirect.url (merchant callback) and no transaction.url, so result.redirectUrl / nextAction become the callback. Fixtures: capturedCharge() inherits redirect from initiatedCharge(); tests never assert redirectUrl unset on captured.\n";
p_c += "TAP-UDF1-PAYMENT-ID: metadataPaymentId scans metadata.paymentId, orderId, THEN udf1 before reference.order. Tap sample udf1=test_data_1 would become WebhookEvent.paymentId and hide reference.order.\n";
p_c += "IMPORTANT:\n";
p_c += "TAP-REFUND-POST: refundPayment POST /refunds omits post.url. webhookUrl / tapPostUrl only go on createPayment. Refund IPNs will not be delivered.\n";
p_c += "TAP-FAWRY-IN-PROGRESS: status.ts CHARGE_STATUS has no IN PROGRESS. Unknown charge status maps to failed. Refunds map IN PROGRESS to pending. Fawry create can look like a hard failure.\n";
p_c += "TAP-TOTAL-REFUNDED: mapRefundObject sets totalRefunded from this refund obj.amount. Core field is cumulative total on the payment. Second partial refund would under-report.\n";
p_c += "TAP-CAPTURE-BODY: capture POST /charges sends amount, currency, source.id, reference.idempotent, optional customer.id. Config merchantId and webhookUrl are NOT sent. No preflight that GET authorize status is AUTHORIZED (Tap 1114).\n";
p_c += "TAP-VOID-RETRY: voidPayment uses tapRequest retry:true. isTapRetryableError retries all NetworkError including afterProviderSubmit. Tap void is not in the idempotency docs and has no body schema. Timeout after a successful void then retry can 400 and fail the op.\n";
p_c += "TAP-REFUND-REASON: refundReason remaps any unrecognized reason to requested_by_customer. Tap examples use free-text reasons; 1156/1157 treat reason as a length-limited string.\n";
p_c += "TAP-TYPES-CREATE: TapGateway.createPayment(params: CreatePaymentParams) so a literal with tapCustomer is a TS excess-property error. README shows that literal. Widen the method to accept optional tapCustomer/tapSource/tapPostUrl/tapThreeDSecure/tapMerchantId.\n";
p_c += "TAP-1151-TIMEOUT: http.ts mapTapHttpFailure treats 2101 and 9999 as NetworkError but not 1151 Gateway timed out. Mutating 1151 becomes GatewayApiError (looks like failed — retry create).\n";
p_c += "NITS (still confirm):\n";
p_c += "TAP-PCI-DEAD: sources.ts on_file===true && rec.card check is unreachable after rec.card throw.\n";
p_c += "TAP-TIMEOUT-MS: copyTapConfig copies timeoutMs without rejecting non-positive values.\n";
p_c += "TAP-HASH-CATCH: verifyTapHashstring catch around timingSafeEqualHex is dead (timingSafeEqualHex does not throw).\n";
p_c += "SKIP TAP-HASH-VECTOR (no live Tap secret to record an official hashstring). Put it in skipped[].\n";
p_c += "Return confirmed[] as ID strings, already_fixed[], skipped[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:tap-findings",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    critic_json = json_encode(critic.output);
}

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Three non-overlapping Tap fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Critic JSON (skip IDs in already_fixed): " + critic_json + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style (no new comment noise). Do not weaken tests. Prefer fail-closed.\n";
rules += "Never treat CAPTURED/AUTHORIZED merchant callback as checkout redirect. Never use metadata.udf1 as paymentId.\n";
rules += "Never invent totalRefunded=0. Never retry void afterProviderSubmit. Never map IN PROGRESS charge to failed.\n";

let p_a = rules;
p_a += "STREAM A — GATEWAY + TESTS + FIXTURES. OWN ONLY:\n";
p_a += "- packages/gateway-tap/src/gateway.ts\n";
p_a += "- packages/gateway-tap/src/gateway.test.ts\n";
p_a += "- packages/gateway-tap/src/fixtures/charges.ts\n";
p_a += "- packages/gateway-tap/src/types.ts\n";
p_a += "- packages/gateway-tap/src/factory.types.test.ts\n";
p_a += "Do NOT edit status.ts, http.ts, sources.ts, webhooks.ts, config.ts, docs, README, CHANGELOG.\n";
p_a += "FIX TAP-REDIRECT-URL: redirectUrl() must return ONLY transaction.url (non-empty string). Do NOT read obj.redirect.url. Tests: capturedCharge() (which already has redirect.url and no transaction.url) must have result.redirectUrl undefined and nextAction undefined, isPaidOutcome true. Add authorizedObject({ redirect: { url: 'https://merchant.example/callback' } }) createPayment capture:false — outcome succeeded, status authorized, redirectUrl undefined.\n";
p_a += "FIX TAP-UDF1-PAYMENT-ID: metadataPaymentId order: metadata.paymentId, metadata.orderId, then reference.order. NEVER udf1. Test parseWebhookEvent(capturedCharge({ metadata: { udf1: 'test_data_1' }, reference: { order: 'ord_01', payment: 'payref1' } })) paymentId is ord_01 not test_data_1. Test metadata.paymentId still wins.\n";
p_a += "FIX TAP-REFUND-POST: refund POST body includes post: { url } when tapConfig.webhookUrl or a future per-request field is set. Test existing refund test: body.post.url is https://merchant.example/post (createGateway already sets webhookUrl).\n";
p_a += "FIX TAP-TOTAL-REFUNDED: do NOT set totalRefunded from this refund's amount. Omit the field (fail-closed). Test refund result.totalRefunded is undefined.\n";
p_a += "FIX TAP-CAPTURE-BODY: on capture POST /charges also send merchant: { id } when tapConfig.merchantId set, and post: { url } when webhookUrl set. After GET authorize, if status is a string and normalize is not AUTHORIZED, throw InvalidRequestError before POST /charges (message mentions authorize status). Test: createGateway with merchantId in config — you will need to extend the local createGateway helper OR construct TapGateway with { secretKey, webhookUrl, merchantId }. Capture of VOID authorize (authorizedObject({ status: 'VOID' })) throws InvalidRequestError and does not POST /charges (only the GET). Capture happy path still POST /charges with source.id = auth id AND post.url when webhookUrl set.\n";
p_a += "FIX TAP-VOID-RETRY: void POST must NOT retry NetworkError.afterProviderSubmit. Keep retry for pre-submit NetworkError / RateLimitError if easy; otherwise retry:false on the void POST is acceptable because a failed void is GET-reconcilable. Test: queue one mutating 500 JSON on void — result is indeterminate (or thrown NetworkError) AND calls.length is 1 (no three retries). Contrast createPayment 5xx still retries (do not break existing 3-response 500 test).\n";
p_a += "FIX TAP-REFUND-REASON: if tapReason is a known enum, use it. Else if params.reason is non-empty, send it trimmed (Tap accepts free text). Only default requested_by_customer when reason is missing/blank. Test: refundPayment reason: 'The product is out of stock' sends that string, not requested_by_customer. Keep duplicate/fraudulent/requested_by_customer mapping for those exact (case-insensitive, spaces to underscore) values.\n";
p_a += "FIX TAP-TYPES-CREATE: type createPayment params as CreatePaymentParams intersect optional tapCustomer, tapSource, tapPostUrl, tapThreeDSecure, tapMerchantId (reuse types from types.ts). refundPayment params as RefundParams & { tapReason?: TapRefundReason }. In factory.types.test.ts add a block that assigns a fresh object literal with tapCustomer into gateway.createPayment without a type assertion (this file is typecheck:types).\n";

let p_b = rules;
p_b += "STREAM B — STATUS, HTTP, SOURCES, WEBHOOKS, CONFIG. OWN ONLY:\n";
p_b += "- packages/gateway-tap/src/status.ts\n";
p_b += "- packages/gateway-tap/src/status.test.ts\n";
p_b += "- packages/gateway-tap/src/http.ts\n";
p_b += "- packages/gateway-tap/src/http.test.ts\n";
p_b += "- packages/gateway-tap/src/sources.ts\n";
p_b += "- packages/gateway-tap/src/sources.test.ts\n";
p_b += "- packages/gateway-tap/src/webhooks.ts\n";
p_b += "- packages/gateway-tap/src/webhooks.test.ts\n";
p_b += "- packages/gateway-tap/src/config.ts\n";
p_b += "- packages/gateway-tap/src/factory.test.ts\n";
p_b += "Do NOT edit gateway.ts, types.ts, fixtures, docs, README, CHANGELOG, factory.ts, factory.types.test.ts.\n";
p_b += "FIX TAP-FAWRY-IN-PROGRESS: CHARGE_STATUS['IN PROGRESS'] = pending (same as INITIATED). mapTapChargeOutcome('IN PROGRESS', pending, url) is requires_action. Test mapTapChargeStatus('IN PROGRESS') is pending and outcome with a url is requires_action. Add IN PROGRESS to TapChargeStatus in types.ts ONLY if you own types.ts — you do NOT; keep the Record<string, PaymentStatus> key without changing types.ts.\n";
p_b += "FIX TAP-1151-TIMEOUT: mapTapHttpFailure treats code 1151 like 2101/9999: NetworkError, afterProviderSubmit when mutating. Test POST status 400 body errors code 1151 is NetworkError with afterProviderSubmit true. GET 400 1151 is NetworkError without afterProviderSubmit.\n";
p_b += "FIX TAP-PCI-DEAD: delete the unreachable on_file && rec.card branch, OR reject on_file===true even when card is missing if that is PCI-meaningful. Prefer delete dead branch. Keep source.card reject test.\n";
p_b += "FIX TAP-TIMEOUT-MS: copyTapConfig / assert: if timeoutMs is present it must be a finite number > 0, else InvalidRequestError. factory.test.ts: tapGateway({ secretKey, timeoutMs: 0 }) and timeoutMs: -1 throw.\n";
p_b += "FIX TAP-HASH-CATCH: in verifyTapHashstring, do not wrap timingSafeEqualHex in a catch that returns false unless it actually throws in this repo — read crypto-portable.ts. If it never throws, call it directly so a real compare error is not swallowed. Keep catch around hashFieldsFromTapObject (fail closed to false).\n";

let p_d = rules;
p_d += "STREAM C — DOCS + CHANGELOG. OWN ONLY:\n";
p_d += "- packages/gateway-tap/docs/authorize.md\n";
p_d += "- packages/gateway-tap/docs/charges.md\n";
p_d += "- packages/gateway-tap/docs/refunds.md\n";
p_d += "- packages/gateway-tap/docs/webhooks.md\n";
p_d += "- packages/gateway-tap/docs/status-mapping.md\n";
p_d += "- packages/gateway-tap/docs/idempotency.md\n";
p_d += "- packages/gateway-tap/docs/production-checklist.md\n";
p_d += "- packages/gateway-tap/README.md\n";
p_d += "- packages/gateway-tap/CHANGELOG.md\n";
p_d += "Do NOT edit packages/gateway-tap/src/** except you may not edit src at all.\n";
p_d += "Docs must match the code AFTER streams A/B (describe intended fixed behavior):\n";
p_d += "authorize.md: capture sends merchant.id from config and post.url from webhookUrl when set; capture requires authorize status AUTHORIZED; redirectUrl on results is transaction.url only (merchant redirect.url is not a next action).\n";
p_d += "charges.md: INITIATED and IN PROGRESS (Fawry) are requires_action when transaction.url is present; CAPTURED is paid and must not set nextAction from redirect.url.\n";
p_d += "refunds.md: POST includes post.url from webhookUrl; reason is tapReason or caller reason or requested_by_customer; totalRefunded is omitted unless a true cumulative figure exists (this adapter omits it).\n";
p_d += "webhooks.md: paymentId from metadata.paymentId / metadata.orderId / reference.order — not udf1. hashstring still ISO-padded amount.\n";
p_d += "status-mapping.md: add IN PROGRESS -> pending / requires_action for charges.\n";
p_d += "idempotency.md: void is NOT Tap-idempotent; do not retry void afterProviderSubmit; charges/refunds/authorize still keyed.\n";
p_d += "production-checklist.md: fulfill on isPaidOutcome; do not redirect on result.redirectUrl unless outcome is requires_action AND url is transaction.url / checkout host.\n";
p_d += "README: keep tapCustomer example; mention createPayment on TapGateway accepts tap* fields. Unreleased CHANGELOG bullets for the fixes. Do not invent live hash vectors.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:tap-gateway", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:tap-status-http", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:tap-docs", capability_mode: "all", output_schema: fix_schema },
]);

let fi = 0;
for f in fixes {
    log("Fix stream " + fi.to_string() + ": " + safe_summary(f));
    fi += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Typecheck and gateway-tap tests");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root. Paste relevant fail lines in failures[].\n";
p_v += "1) bun run --filter @paykernel/gateway-tap typecheck\n";
p_v += "2) bun run --filter @paykernel/gateway-tap typecheck:types\n";
p_v += "3) bun test packages/gateway-tap\n";
p_v += "If a script 404s, skip and note it.\n";
p_v += "4) Grep/read invariants (must hold):\n";
p_v += "   - redirectUrl() in gateway.ts does not read obj.redirect.url\n";
p_v += "   - metadataPaymentId does not include udf1\n";
p_v += "   - refund POST body can include post.url\n";
p_v += "   - CHARGE_STATUS or mapTapChargeStatus maps IN PROGRESS to pending\n";
p_v += "   - mapTapHttpFailure treats 1151 as NetworkError\n";
p_v += "   - void path does not retry afterProviderSubmit (retry false or isRetryable excludes it)\n";
p_v += "   - mapRefundObject does not set totalRefunded from obj.amount\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass.\n";

let verify = agent(p_v, #{
    label: "verify:tap-tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Tap blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence AND a test exists for each blocking ID.\n";
p_g += "BLOCKERS:\n";
p_g += "TAP-REDIRECT-URL: redirectUrl uses only transaction.url. Captured/authorized objects with merchant redirect.url do not set result.redirectUrl or nextAction. Test exists.\n";
p_g += "TAP-UDF1-PAYMENT-ID: parseWebhookEvent paymentId is reference.order (or metadata.paymentId/orderId), never metadata.udf1. Test exists.\n";
p_g += "TAP-REFUND-POST: refund JSON includes post.url when webhookUrl configured. Test exists.\n";
p_g += "TAP-FAWRY-IN-PROGRESS: charge IN PROGRESS is pending / requires_action, not failed. Test exists.\n";
p_g += "TAP-VOID-RETRY: void mutating 5xx is not retried 3 times. Test exists.\n";
p_g += "TAP-1151-TIMEOUT: code 1151 is NetworkError. Test exists.\n";
p_g += "TAP-TOTAL-REFUNDED: refund result does not publish this-refund amount as totalRefunded. Test exists.\n";
p_g += "TAP-CAPTURE-BODY: capture of non-AUTHORIZED throws before POST /charges; merchant/post forwarded when config set.\n";
p_g += "TAP-REFUND-REASON: free-text reason is not rewritten to requested_by_customer. Test exists.\n";
p_g += "TAP-TYPES-CREATE: TapGateway.createPayment accepts tapCustomer on an object literal (factory.types.test.ts or equivalent type test).\n";
p_g += "Non-blocking allowed if still present: TAP-HASH-VECTOR, TAP-PCI-DEAD leftover, TAP-HASH-CATCH leftover, TAP-TIMEOUT-MS if documented.\n";
p_g += "Return {pass, blocking, non_blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:tap-adversarial",
    capability_mode: "read-only",
    output_schema: gate_schema,
});
log("Gate: " + safe_summary(gate));

let gate_pass = false;
if gate != () && gate.success && gate.output != () && gate.output.pass == true {
    gate_pass = true;
}

let verify_ok = false;
if verify != () && verify.success && verify.output != () && verify.output.ok == true {
    verify_ok = true;
}

// ─── Remediate ───────────────────────────────────────────────────
phase("Remediate");
if gate_pass && verify_ok {
    log("Gate passed and verify ok; skipping remediate");
} else {
    log("Remediating remaining Tap blockers");
    let blockers = "";
    if gate != () && gate.success && gate.output != () && gate.output.blocking != () {
        for b in gate.output.blocking {
            blockers += b + "\n";
        }
    }
    if !verify_ok {
        blockers += "Verify failed or incomplete. Re-run typecheck and failing tests after fixes.\n";
        if verify != () && verify.success && verify.output != () && verify.output.failures != () {
            blockers += "Verify failures: " + json_encode(verify.output.failures) + "\n";
        }
    }
    if blockers == "" {
        blockers += "Gate missing or failed closed. Re-read TAP-REDIRECT-URL, TAP-UDF1-PAYMENT-ID, TAP-REFUND-POST, TAP-FAWRY-IN-PROGRESS, TAP-VOID-RETRY, TAP-1151-TIMEOUT, TAP-TOTAL-REFUNDED, TAP-CAPTURE-BODY, TAP-REFUND-REASON, TAP-TYPES-CREATE and fix any still present.\n";
    }

    let p_r = "";
    p_r += "Repo: " + root + "\n";
    p_r += "Do NOT commit or push. You may edit packages/gateway-tap/** only.\n";
    p_r += "REMEDIATE remaining Tap review blockers with tests. Then run:\n";
    p_r += "bun run --filter @paykernel/gateway-tap typecheck && bun run --filter @paykernel/gateway-tap typecheck:types && bun test packages/gateway-tap\n";
    p_r += "Blockers:\n";
    p_r += blockers;
    p_r += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_r, #{
        label: "remediate:tap-blockers",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    log("Remediate: " + safe_summary(rem));

    let p_v2 = "";
    p_v2 += "Re-verify " + root + " after Tap remediation.\n";
    p_v2 += "Run bun run --filter @paykernel/gateway-tap typecheck && bun run --filter @paykernel/gateway-tap typecheck:types && bun test packages/gateway-tap.\n";
    p_v2 += "Re-check blocking invariants: redirectUrl only transaction.url; no udf1 paymentId; refund post.url; IN PROGRESS pending; void no afterProviderSubmit retry; 1151 NetworkError; no lying totalRefunded.\n";
    p_v2 += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}.\n";
    let ver2 = agent(p_v2, #{
        label: "verify:tap-post-remediate",
        capability_mode: "execute",
        output_schema: verify_schema,
    });
    log("Post-remediate verify: " + safe_summary(ver2));
    if ver2 != () && ver2.success && ver2.output != () && ver2.output.ok == true {
        verify_ok = true;
    } else {
        verify_ok = false;
    }

    let p_g2 = "";
    p_g2 += "READ-ONLY re-gate of " + root + " after Tap remediation. Fail closed. pass=true only if TAP-REDIRECT-URL, TAP-UDF1-PAYMENT-ID, TAP-REFUND-POST, TAP-FAWRY-IN-PROGRESS, TAP-VOID-RETRY, TAP-1151-TIMEOUT, TAP-TOTAL-REFUNDED, TAP-CAPTURE-BODY, TAP-REFUND-REASON, TAP-TYPES-CREATE are gone with file:line + tests.\n";
    p_g2 += "Return {pass, blocking, non_blocking, summary}.\n";
    let gate2 = agent(p_g2, #{
        label: "gate:tap-post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    log("Post-remediate gate: " + safe_summary(gate2));
    if gate2 != () && gate2.success && gate2.output != () && gate2.output.pass == true {
        gate_pass = true;
    } else {
        gate_pass = false;
        if gate2 != () && gate2.success && gate2.output != () {
            gate = gate2;
        }
    }
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
let final_pass = gate_pass == true && verify_ok == true;

let blocking_txt = "";
if gate != () && gate.success && gate.output != () && gate.output.blocking != () {
    for b in gate.output.blocking {
        blocking_txt += "- " + b + "\n";
    }
}
let non_txt = "";
if gate != () && gate.success && gate.output != () && gate.output.non_blocking != () {
    for n in gate.output.non_blocking {
        non_txt += "- " + n + "\n";
    }
}

let p_rep = "";
p_rep += "Write a concise Tap fix-gate report via write_scratch_file name phase-23-tap-fix-gate.md (do NOT create docs/audits).\n";
p_rep += "Repo: " + root + "\n";
p_rep += "final_pass=" + final_pass.to_string() + " gate_pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + "\n";
p_rep += "Critic: " + safe_summary(critic) + "\n";
p_rep += "Verify: " + safe_summary(verify) + "\n";
p_rep += "Gate: " + safe_summary(gate) + "\n";
p_rep += "Blocking:\n" + blocking_txt + "\n";
p_rep += "Non-blocking:\n" + non_txt + "\n";
p_rep += "Read current packages/gateway-tap/src after the fix streams. List each TAP-* ID as FIXED or STILL OPEN with file:line. Do not invent fixes. Do not commit.\n";
p_rep += "Return {ok, summary, report_markdown}.\n";

let report = agent(p_rep, #{
    label: "report:tap-fix-gate",
    capability_mode: "all",
    output_schema: report_schema,
});
log("Report: " + safe_summary(report));

complete(#{
    summary: "Tap fix-gate finished. final_pass=" + final_pass.to_string() + " gate_pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + ". " + safe_summary(report),
    final_pass: final_pass,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
});
