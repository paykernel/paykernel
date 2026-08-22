let meta = #{
    name: "phase-23-tap-r5-fix-gate",
    description: "Critic, fix, verify, and adversarially gate the 2026-08-22 Tap deep-review leftovers: missing-status 2xx, CAPTURED replay, auth/charge identity, refund remaining, currency match, 11xx HTTP, customer fields, decline codes, create reconcile docs",
    phases: [
        #{ title: "Critic", detail: "reconfirm every TAP-R5 ID against current gateway-tap code" },
        #{ title: "Fix", detail: "three non-overlapping streams for confirmed findings" },
        #{ title: "Verify", detail: "typecheck plus gateway-tap tests and invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "scratch gate report" },
    ],
    when_to_use: "After the 2026-08-22 gateway-tap correctness review; critic then fix then verify then gate missing-status, capture replay, identity, refund remaining, and related leftovers",
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

fn join_lines(items) {
    let out = "";
    if items == () { return out; }
    for item in items {
        out += item + "\n";
    }
    out
}

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Confirming 2026-08-22 Tap r5 review findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep on packages/gateway-tap/src and packages/gateway-tap/docs. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence. Return confirmed[] as ID strings only.\n";
p_c += "Tap / core facts (do not invent the opposite):\n";
p_c += "- Mutating HTTP 2xx with id but no status is uncertain. Stripe/PayPal map missing mutation status to indeterminate, not failed.\n";
p_c += "- Capture is POST /v2/charges with source.id = auth_…. Tap errors 1114 (check Authorize status) and 1126 (source already used) apply when the authorize is already CAPTURED.\n";
p_c += "- Retrieve authorize OpenAPI does not document a charge_id. Refunds require chg_ ids.\n";
p_c += "- Core RefundParams omitted amount means full remaining refund, not the original charge total.\n";
p_c += "- Tap 1101 is Secret API Key and Environment are mismatched (auth). 1126 source already used. 1149 currency not matching existing. 1150 capture amount exceeds authorized. 1161 refund amount exceeds.\n";
p_c += "- Charge object response codes 501-516 are declines. Object status DECLINED is the usual pair; FAILED + 505 must not look like a generic failed retry.\n";
p_c += "- r2 TAP-CAPTURE-FIELDS already sends threeDSecure:true and customer_initiated:true on capture because Tap says do not set them false. Do NOT put TAP-CAPTURE-3DS in confirmed[] as a code change to set them false. Put TAP-CAPTURE-3DS in skipped[].\n";
p_c += "- Do NOT split gateway.ts for size. Do NOT add PaymentClient tap* overloads in core. Do NOT change outbound JSON amounts from numbers to padded strings. Put TAP-GOD-CLASS, TAP-CLIENT-OVERLOAD, TAP-JSON-PAD, TAP-GET-CONTENT-TYPE in skipped[].\n";
p_c += "BLOCKING:\n";
p_c += "TAP-MISSING-STATUS: mapPaymentObject / mapRefundObject default missing status to UNKNOWN then failed. assertTapSuccessBody accepts mutating 2xx with only id. Still present if POST 200 {id} without status is not NetworkError afterProviderSubmit / indeterminate.\n";
p_c += "TAP-CAPTURE-REPLAY: capturePayment POSTs /charges when GET authorize is CAPTURED. Tests mock that POST succeeding. Still present if CAPTURED still POSTs. Intended fix is GET CAPTURED must NOT POST (map paid + keep authorizationId; GET nested charge id if present). 1126 must be InvalidRequestError.\n";
p_c += "IMPORTANT:\n";
p_c += "TAP-AUTH-CHARGE-ID: capture result maps kind charge so authorizationId is omitted. Charge webhooks set gatewayPaymentId to chg_ with no auth_ back-pointer. Still present if capturePayment does not set authorizationId to the auth_ id.\n";
p_c += "TAP-REFUND-REMAINING: omitted refund amount uses parseTapAmount(charge.amount). Still present if omitted amount always sends original charge.amount with no remaining/already-refunded handling.\n";
p_c += "TAP-CURRENCY-MATCH: capture/refund use p.currency ?? existing.currency with no mismatch throw. Still present if caller currency USD vs authorize SAR does not throw before POST.\n";
p_c += "TAP-CREATE-RECONCILE: production-checklist says timeouts need getPayment. Create never had chg_/auth_ id. Still present if checklist tells operators to getPayment after create timeout.\n";
p_c += "TAP-HTTP-11XX: INVALID_REQUEST_CODES is only 1106 and 1114. 1126/1110/1111/1118/1119/1124/1125/1149 are GatewayApiError. Still present if 1126 and 1149 are not InvalidRequestError.\n";
p_c += "TAP-CUSTOMER-FIELDS: serializeCustomer requires non-empty lastName only. Still present if blank firstName or email is sent to Tap.\n";
p_c += "TAP-DECLINE-CODES: isTapDeclineStatus is only DECLINED. Still present if FAILED + response.code 505 is outcome failed without decline extras.\n";
p_c += "NITS (confirm, may stay non-blocking unless easy): TAP-REASON-LENGTH (reason >250), TAP-KEY-TRIM (idempotencyKey / secretKey not trimmed), TAP-FAWRY-DOC (docs say IN PROGRESS requires_action only when transaction.url present; code maps all pending to requires_action).\n";
p_c += "SKIP TAP-CAPTURE-3DS, TAP-GOD-CLASS, TAP-CLIENT-OVERLOAD, TAP-JSON-PAD, TAP-GET-CONTENT-TYPE. Put them in skipped[].\n";
p_c += "Return confirmed[], already_fixed[], skipped[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:tap-r5",
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
log("Three non-overlapping Tap r5 fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Critic JSON (skip IDs in already_fixed and skipped): " + critic_json + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style (no new comment noise). Do not weaken tests. Prefer fail-closed.\n";
rules += "Do NOT set capture threeDSecure or customer_initiated to false. Do NOT edit packages/core. Do NOT default auto VOID.\n";
rules += "Tap facts: CAPTURED authorize means the hold was captured; VOID means released. Mutating 2xx without status is indeterminate. Refunds need chg_ ids.\n";

let p_a = rules;
p_a += "STREAM A — GATEWAY + TESTS. OWN ONLY:\n";
p_a += "- packages/gateway-tap/src/gateway.ts\n";
p_a += "- packages/gateway-tap/src/gateway.test.ts\n";
p_a += "- packages/gateway-tap/src/types.ts (only if a type is required for capture/refund params you already own)\n";
p_a += "Do NOT edit status.ts, http.ts, sources.ts, webhooks.ts, money.ts, config.ts, factory.ts, docs, README, CHANGELOG.\n";
p_a += "FIX TAP-MISSING-STATUS: After a usable mutating 2xx object with id, if status is missing or not a non-empty string, throw NetworkError with afterProviderSubmit true (message mentions missing status). GET missing status throws NetworkError WITHOUT afterProviderSubmit. Do not map missing status to UNKNOWN/failed. Tests: POST create 200 {id:chg_x} no status is indeterminate (isIndeterminateOutcome) after retries if needed — queue 3 copies if withRetry retries; refund POST 200 {id:re_x} no status is indeterminate; GET /charges 200 {id:chg_x} no status throws NetworkError afterProviderSubmit not true.\n";
p_a += "FIX TAP-CAPTURE-REPLAY: After GET authorize, AUTHORIZED still POSTs /charges. CAPTURED must NOT POST /charges. Map the authorize object as paid (status paid, outcome succeeded) and set authorizationId to the auth_ id. If the authorize JSON has a string charge id (charge_id or nested charge.id starting with chg_), GET that charge and mapPaymentObject(charge, charge) while keeping authorizationId = auth id. VOID and INITIATED still throw before POST. REPLACE the test that POSTs on CAPTURED: GET CAPTURED must not call /charges; result is paid with authorizationId auth_testAuthorize01. Keep VOID reject. Keep AUTHORIZED happy-path POST.\n";
p_a += "FIX TAP-AUTH-CHARGE-ID: capturePayment AUTHORIZED path: after mapping the charge, set authorizationId (and references.authorizationId via buildProviderReferences) to the auth_ id. Test happy-path capture result.authorizationId is auth_testAuthorize01 and gatewayId is the charge id. parseWebhookEvent for a charge whose source.id is auth_… should still use chg_ as gatewayPaymentId; put the auth id on event.event.payment.references.authorizationId if the snapshot exposes it, or on a documented field you already have (do not invent webhook schema). Add a webhook test that source.id auth_ does not become gatewayPaymentId.\n";
p_a += "FIX TAP-REFUND-REMAINING: When refund amount is omitted, GET the charge then: if you can read a remaining/refundable amount (remaining, amount_refunded, refunded, refunds[].amount sum) compute remaining via Money and send that; if remaining is 0 throw InvalidRequestError (already refunded); if you cannot see refunded fields, send charge.amount (first full refund). If charge status is REFUNDED throw InvalidRequestError before POST. Test: omitted amount on a charge with amount_refunded 4 and amount 10.5 posts 6.5 (or remaining 6.5); REFUNDED charge throws and does not POST /refunds.\n";
p_a += "FIX TAP-CURRENCY-MATCH: If caller p.currency is a non-empty string and the retrieved object currency is a string and they differ case-insensitively, throw InvalidRequestError before POST (capture and refund). Test capture currency USD vs authorize SAR throws and does not POST /charges.\n";
p_a += "FIX TAP-CUSTOMER-FIELDS: serializeCustomer inline path requires trimmed non-empty firstName, lastName, and email (Tap 1130/1132/1138). Blank/whitespace throws InvalidRequestError before fetch. Keep existing lastName test; add firstName and email blank tests.\n";
p_a += "NITS if cheap: trim idempotencyKey when present (createIdempotencyKey and assertMutationKey) so the posted reference.idempotent is trimmed.\n";

let p_b = rules;
p_b += "STREAM B — HTTP + STATUS + WEBHOOKS. OWN ONLY:\n";
p_b += "- packages/gateway-tap/src/http.ts\n";
p_b += "- packages/gateway-tap/src/http.test.ts\n";
p_b += "- packages/gateway-tap/src/status.ts\n";
p_b += "- packages/gateway-tap/src/status.test.ts\n";
p_b += "- packages/gateway-tap/src/webhooks.ts\n";
p_b += "- packages/gateway-tap/src/webhooks.test.ts\n";
p_b += "Do NOT edit gateway.ts, gateway.test.ts, types.ts, config.ts, sources.ts, money.ts, docs, README, CHANGELOG.\n";
p_b += "FIX TAP-HTTP-11XX: add 1126, 1110, 1111, 1118, 1119, 1124, 1125, 1149 to INVALID_REQUEST_CODES (keep 1106 and 1114). Tests: POST 400 code 1126 is InvalidRequestError; POST 400 code 1149 is InvalidRequestError. Keep 1106/1114 tests.\n";
p_b += "FIX TAP-DECLINE-CODES: isTapDeclineStatus(tapStatus, responseCode?) is true when normalized status is DECLINED OR response code is 501-516 inclusive (string or number). mapTapChargeOutcome(tapStatus, paymentStatus, responseCode?) returns declined in those cases even if paymentStatus is failed. Export the helpers so gateway.ts current call sites still typecheck: keep mapTapChargeOutcome(tapStatus, paymentStatus) working with optional third arg; isTapDeclineStatus(tapStatus) still works with optional second arg. Tests: mapTapChargeOutcome(FAILED, failed, 505) is declined; isTapDeclineStatus(FAILED, 505) true; isTapDeclineStatus(CAPTURED, 000) false. Gateway.ts already passes tapStatus into both — Stream A will pass code if the signature allows it. If you add the optional arg, Stream A can pass tapResponseCode without a conflict if you land first; if gateway.ts still compiles with one-arg isTapDeclineStatus that is required (optional second param).\n";
p_b += "If TAP-MISSING-STATUS needs assertTapSuccessBody to require status on mutating 2xx, do that here: mutating 2xx object with id but missing/non-string status throws NetworkError afterProviderSubmit (message missing status). Test assertTapSuccessBody POST 200 data {id:chg_1} without status throws NetworkError afterProviderSubmit. Keep id-required tests.\n";

let p_d = rules;
p_d += "STREAM C — DOCS + CHANGELOG. OWN ONLY:\n";
p_d += "- packages/gateway-tap/docs/authorize.md\n";
p_d += "- packages/gateway-tap/docs/charges.md\n";
p_d += "- packages/gateway-tap/docs/refunds.md\n";
p_d += "- packages/gateway-tap/docs/status-mapping.md\n";
p_d += "- packages/gateway-tap/docs/idempotency.md\n";
p_d += "- packages/gateway-tap/docs/production-checklist.md\n";
p_d += "- packages/gateway-tap/docs/webhooks.md\n";
p_d += "- packages/gateway-tap/docs/overview.md\n";
p_d += "- packages/gateway-tap/README.md\n";
p_d += "- packages/gateway-tap/CHANGELOG.md\n";
p_d += "Do NOT edit packages/gateway-tap/src/** at all.\n";
p_d += "Docs must match the INTENDED fixed behavior (after streams A/B):\n";
p_d += "authorize.md: capture GET AUTHORIZED then POST /charges. GET CAPTURED does not POST — returns paid and keeps authorizationId (crash-retry after completed capture). VOID rejected. Capture result authorizationId is the auth_ id; gatewayId is the charge id. Capture still sends threeDSecure true and customer_initiated true (do not say to set them false). Capture may still requires_action if Tap returns INITIATED.\n";
p_d += "refunds.md: omitted amount is remaining when the charge exposes refunded/remaining; REFUNDED charge cannot be refunded again. After a partial refund pass remaining explicitly if the charge does not expose refunded.\n";
p_d += "webhooks.md: charge webhooks use chg_ as gatewayPaymentId. Auth/capture merchants must also match reference.order / metadata.paymentId because capture settlement is a charge object. Do not treat metadata.udf1 as paymentId.\n";
p_d += "production-checklist.md: FIX TAP-CREATE-RECONCILE — createPayment timeout / 5xx / 1151 after submit: replay createPayment with the SAME idempotencyKey. Do NOT getPayment until you have a chg_ or auth_ id. capture/void/refund timeouts: getPayment(auth_ or chg_). Store chg_ vs auth_ separately; refunds need chg_. Capture result.authorizationId is the auth id.\n";
p_d += "status-mapping.md: missing object status after mutating 2xx is indeterminate, not UNKNOWN/failed. FAILED + response.code 501-516 is declined. CAPTURED authorize on getPayment is paid; capturePayment does not POST on CAPTURED.\n";
p_d += "idempotency.md: CAPTURED authorize is not a POST replay.\n";
p_d += "CHANGELOG Unreleased Patch bullets TAP-MISSING-STATUS, TAP-CAPTURE-REPLAY, TAP-AUTH-CHARGE-ID, TAP-REFUND-REMAINING, TAP-CURRENCY-MATCH, TAP-CREATE-RECONCILE, TAP-HTTP-11XX, TAP-CUSTOMER-FIELDS, TAP-DECLINE-CODES. Rewrite TAP-CAPTURE-STATUS so it no longer says CAPTURED replays POST /charges.\n";
p_d += "README: inline customer needs firstName lastName email all non-empty; capture result keeps authorizationId.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:tap-r5-gateway", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:tap-r5-http-status", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:tap-r5-docs", capability_mode: "all", output_schema: fix_schema },
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
p_v += "   - mutating 2xx without status is NetworkError afterProviderSubmit, not UNKNOWN/failed\n";
p_v += "   - capturePayment CAPTURED does not POST /charges\n";
p_v += "   - capture AUTHORIZED result sets authorizationId to auth_ id\n";
p_v += "   - capture currency mismatch throws before POST\n";
p_v += "   - inline customer blank firstName/email throws\n";
p_v += "   - 1126 and 1149 are InvalidRequestError\n";
p_v += "   - FAILED + 505 is declined\n";
p_v += "   - production-checklist create timeout says replay createPayment with same idempotencyKey, not getPayment\n";
p_v += "   - capture still sends threeDSecure true and customer_initiated true\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass AND invariants hold.\n";

let verify = agent(p_v, #{
    label: "verify:tap-r5-tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Tap r5 blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence AND a test exists for each blocking ID.\n";
p_g += "BLOCKERS:\n";
p_g += "TAP-MISSING-STATUS: mutating 2xx missing status is afterProviderSubmit NetworkError / indeterminate, not failed UNKNOWN. Tests exist for create and refund (or assertTapSuccessBody + gateway).\n";
p_g += "TAP-CAPTURE-REPLAY: GET CAPTURED does not POST /charges. Test exists. CHANGELOG/docs must not still say CAPTURED replays POST /charges.\n";
p_g += "TAP-AUTH-CHARGE-ID: capture AUTHORIZED sets authorizationId to auth_ id. Test exists.\n";
p_g += "TAP-CURRENCY-MATCH: capture caller currency vs authorize currency mismatch throws before POST. Test exists.\n";
p_g += "TAP-CUSTOMER-FIELDS: blank firstName and email throw. Tests exist.\n";
p_g += "TAP-HTTP-11XX: 1126 and 1149 are InvalidRequestError. Tests exist.\n";
p_g += "TAP-DECLINE-CODES: FAILED + 505 is declined. Test exists.\n";
p_g += "TAP-CREATE-RECONCILE: production-checklist create timeout is replay same idempotencyKey, not getPayment.\n";
p_g += "TAP-REFUND-REMAINING: omitted amount uses remaining when amount_refunded present, or REFUNDED throws. Test exists.\n";
p_g += "Must still hold (do not regress): VOID capture throws; threeDSecure true + customer_initiated true on AUTHORIZED capture POST; ACCEPTED refund pending; lastName required; 1106 InvalidRequestError.\n";
p_g += "Non-blocking allowed: TAP-CAPTURE-3DS leftover docs, TAP-REASON-LENGTH, TAP-KEY-TRIM, TAP-FAWRY-DOC, TAP-GOD-CLASS.\n";
p_g += "Return {pass, blocking, non_blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:tap-r5-adversarial",
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
    log("Remediating remaining Tap r5 blockers");
    let blockers = "";
    if gate != () && gate.success && gate.output != () && gate.output.blocking != () {
        blockers += join_lines(gate.output.blocking);
    }
    if !verify_ok {
        blockers += "Verify failed or incomplete. Re-run typecheck and failing tests after fixes.\n";
        if verify != () && verify.success && verify.output != () && verify.output.failures != () {
            blockers += "Verify failures: " + json_encode(verify.output.failures) + "\n";
        }
    }
    if blockers == "" {
        blockers += "Gate missing or failed closed. Re-read TAP-MISSING-STATUS, TAP-CAPTURE-REPLAY, TAP-AUTH-CHARGE-ID, TAP-REFUND-REMAINING, TAP-CURRENCY-MATCH, TAP-CREATE-RECONCILE, TAP-HTTP-11XX, TAP-CUSTOMER-FIELDS, TAP-DECLINE-CODES and fix any still present.\n";
    }

    let p_r = "";
    p_r += "Repo: " + root + "\n";
    p_r += "Do NOT commit or push. You may edit packages/gateway-tap/** only.\n";
    p_r += "REMEDIATE remaining Tap r5 review blockers with tests. Then run:\n";
    p_r += "bun run --filter @paykernel/gateway-tap typecheck && bun run --filter @paykernel/gateway-tap typecheck:types && bun test packages/gateway-tap\n";
    p_r += "Tap facts: CAPTURED authorize must not POST /charges. Missing mutation status is indeterminate. Do not set threeDSecure false. Do not edit core.\n";
    p_r += "Blockers:\n";
    p_r += blockers;
    p_r += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_r, #{
        label: "remediate:tap-r5-blockers",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    log("Remediate: " + safe_summary(rem));

    let p_v2 = "";
    p_v2 += "Re-verify " + root + " after Tap r5 remediation.\n";
    p_v2 += "Run bun run --filter @paykernel/gateway-tap typecheck && bun run --filter @paykernel/gateway-tap typecheck:types && bun test packages/gateway-tap.\n";
    p_v2 += "Re-check: missing status indeterminate; CAPTURED no POST; capture authorizationId; currency mismatch throws; 1126 InvalidRequestError; FAILED+505 declined; checklist create replay; firstName/email required.\n";
    p_v2 += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}.\n";
    let ver2 = agent(p_v2, #{
        label: "verify:tap-r5-post-remediate",
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
    p_g2 += "READ-ONLY re-gate of " + root + " after Tap r5 remediation. Fail closed. pass=true only if TAP-MISSING-STATUS, TAP-CAPTURE-REPLAY, TAP-AUTH-CHARGE-ID, TAP-REFUND-REMAINING, TAP-CURRENCY-MATCH, TAP-CREATE-RECONCILE, TAP-HTTP-11XX, TAP-CUSTOMER-FIELDS, TAP-DECLINE-CODES are gone with file:line + tests. CAPTURED must not POST /charges. Missing mutation status must not be failed.\n";
    p_g2 += "Return {pass, blocking, non_blocking, summary}.\n";
    let gate2 = agent(p_g2, #{
        label: "gate:tap-r5-post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    log("Post-remediate gate: " + safe_summary(gate2));
    if gate2 != () && gate2.success && gate2.output != () && gate2.output.pass == true {
        gate_pass = true;
        gate = gate2;
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
    blocking_txt = join_lines(gate.output.blocking);
}
let non_txt = "";
if gate != () && gate.success && gate.output != () && gate.output.non_blocking != () {
    non_txt = join_lines(gate.output.non_blocking);
}

let p_rep = "";
p_rep += "Write a concise Tap r5 fix-gate report. Do NOT create docs/audits. Do NOT commit.\n";
p_rep += "Repo: " + root + "\n";
p_rep += "final_pass=" + final_pass.to_string() + " gate_pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + "\n";
p_rep += "Critic: " + safe_summary(critic) + "\n";
p_rep += "Verify: " + safe_summary(verify) + "\n";
p_rep += "Gate: " + safe_summary(gate) + "\n";
p_rep += "Blocking:\n" + blocking_txt + "\n";
p_rep += "Non-blocking:\n" + non_txt + "\n";
p_rep += "Read current packages/gateway-tap/src after the fix streams. List each TAP-* ID as FIXED or STILL OPEN with file:line. Do not invent fixes.\n";
p_rep += "IDs: TAP-MISSING-STATUS TAP-CAPTURE-REPLAY TAP-AUTH-CHARGE-ID TAP-REFUND-REMAINING TAP-CURRENCY-MATCH TAP-CREATE-RECONCILE TAP-HTTP-11XX TAP-CUSTOMER-FIELDS TAP-DECLINE-CODES TAP-CAPTURE-3DS.\n";
p_rep += "Return {ok, summary, report_markdown} where report_markdown is the full markdown report.\n";

let report = agent(p_rep, #{
    label: "report:tap-r5-fix-gate",
    capability_mode: "all",
    output_schema: report_schema,
});
log("Report: " + safe_summary(report));

let report_md = "# Tap r5 fix-gate\n\n";
report_md += "final_pass=" + final_pass.to_string() + " gate_pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + "\n\n";
report_md += "Critic: " + safe_summary(critic) + "\n";
report_md += "Verify: " + safe_summary(verify) + "\n";
report_md += "Gate: " + safe_summary(gate) + "\n";
report_md += "Report: " + safe_summary(report) + "\n\n";
report_md += "## Blocking\n" + blocking_txt + "\n";
report_md += "## Non-blocking\n" + non_txt + "\n";
if report != () && report.success && report.output != () && report.output.report_markdown != () {
    report_md += report.output.report_markdown;
}

let report_path = write_scratch_file("phase-23-tap-r5-fix-gate.md", report_md);

complete(#{
    summary: "Tap r5 fix-gate finished. final_pass=" + final_pass.to_string() + " gate_pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + ". " + safe_summary(report),
    final_pass: final_pass,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    path: report_path,
});
