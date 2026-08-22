let meta = #{
    name: "phase-23-tap-r2-fix-gate",
    description: "Critic, fix, verify, and adversarially gate the 2026-08-22 Tap adapter review (capture CAPTURED vs VOID, refund ACCEPTED, leftover AUTHORIZED url, capture fields, authorize source)",
    phases: [
        #{ title: "Critic", detail: "reconfirm every TAP-R2 ID against current gateway-tap code" },
        #{ title: "Fix", detail: "three non-overlapping streams for confirmed findings" },
        #{ title: "Verify", detail: "typecheck plus gateway-tap tests and invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "scratch gate report" },
    ],
    when_to_use: "After the 2026-08-22 @paykernel/gateway-tap deep review; critic then fix then verify then gate capture status, ACCEPTED refunds, leftover authorize URL, and related findings",
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
log("Confirming 2026-08-22 Tap review findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep on packages/gateway-tap/src and packages/gateway-tap/docs. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence. Return confirmed[] as ID strings only.\n";
p_c += "Tap official API facts (do not invent the opposite):\n";
p_c += "- Authorize statuses: AUTHORIZED = hold ok; CAPTURED = authorized amount successfully captured; VOID = authorized amount successfully voided. Error 1114 = please check Authorize status.\n";
p_c += "- Capture is POST /v2/charges with source.id = auth_… . Crash-retry of a completed capture should see GET authorize status CAPTURED and replay POST /charges with the same reference.idempotent.\n";
p_c += "- Refund Logic V2 object status ACCEPTED = accepted, pending Tap processing (response.code 101). Not a failure.\n";
p_c += "- mapTapPaymentOutcome leftover transaction.url: CAPTURED is special-cased (status paid). AUTHORIZED is not. Tap AUTHORIZED samples usually omit transaction.url; leftover url is still a logic hole.\n";
p_c += "- Charge object status IN PROGRESS (space) is Fawry. List filter documents IN_PROGRESS (underscore).\n";
p_c += "- HTTP error table uses 11xx/21xx. Charge/refund response codes 501-516/504 live on 2xx objects. mapTapHttpFailure DECLINE_CODES on !ok responses mislabels refund 504 as CardDeclinedError if Tap puts it in errors[].\n";
p_c += "- Error 1106 is Customer not found (not a missing charge). 1132 last name required exists in the error table; OpenAPI does not mark last_name required. Do NOT require lastName in the public type (would break README Ada example). Put TAP-LAST-NAME in skipped[].\n";
p_c += "- Capture guide: do not set customer_initiated or threeDSecure to false. Create Charge marks redirect required; capture-from-authorize guide does not mention redirect. Do not invent CaptureParams.callbackUrl. Put TAP-CAPTURE-REDIRECT in skipped[] unless current capture POST already has a callback to send.\n";
p_c += "BLOCKING:\n";
p_c += "TAP-CAPTURE-STATUS: capturePayment allows GET authorize VOID and rejects CAPTURED. Tests replay VOID. This inverts Tap docs. Still present if VOID is allowed and CAPTURED throws.\n";
p_c += "TAP-REFUND-ACCEPTED: REFUND_STATUS has no ACCEPTED; unknown maps to failed. Webhook ACCEPTED becomes refund_failed.\n";
p_c += "IMPORTANT:\n";
p_c += "TAP-AUTH-LEFTOVER-URL: mapTapPaymentOutcome returns requires_action whenever redirectUrl is set and status is not paid. AUTHORIZED leftover transaction.url would be requires_action. Tests only cover merchant redirect.url which redirectUrl() does not read.\n";
p_c += "TAP-CAPTURE-FIELDS: capture POST /charges omits threeDSecure and customer_initiated. Tap capture guide says do not set them false. Defaults are true if omitted — still send true explicitly.\n";
p_c += "TAP-AUTHORIZE-AUTO: createPayment capture:false never sends auto {type,time}. Optional TapConfig.autoVoidHours (1-168) should send auto:{type:VOID,time} on authorize create only. Do NOT default it (would silently void holds). Absence is still a finding if config cannot express it.\n";
p_c += "TAP-AUTHORIZE-SOURCE: omitted tapSource defaults src_all even when capture:false. Tap: authorize works only with credit cards. Default src_card when capture===false and tapSource omitted.\n";
p_c += "TAP-CREATE-AUTH-SOURCE: resolveTapSourceId / ALLOWED_SOURCE allows auth_ on createPayment, bypassing capturePayment status precheck.\n";
p_c += "TAP-IN-PROGRESS-UNDERSCORE: CHARGE_STATUS / REFUND_STATUS have IN PROGRESS but not IN_PROGRESS.\n";
p_c += "TAP-HTTP-50X: mapTapHttpFailure maps DECLINE_CODES 501-516 and 505 on any !ok body. Refund response 504 is Partial Refund not Supported.\n";
p_c += "TAP-1106-CUSTOMER: NOT_FOUND_CODES includes 1106 Customer not found as ResourceNotFoundError.\n";
p_c += "TAP-ZERO-AMOUNT: money.ts PARSE_OPTS allowZero true is used by tapMajorNumber for outbound create/capture/refund.\n";
p_c += "TAP-1114-STATUS: error 1114 Please check the Authorize status is untyped GatewayApiError.\n";
p_c += "NITS (confirm, may stay non-blocking): TAP-AMOUNT-RAW (amount InvalidRequestError lacks raw), TAP-CHARGE-CANCELED (charge CANCELED vs CANCELLED).\n";
p_c += "SKIP TAP-LAST-NAME and TAP-CAPTURE-REDIRECT as specified. Put them in skipped[].\n";
p_c += "Return confirmed[], already_fixed[], skipped[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:tap-r2",
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
log("Three non-overlapping Tap r2 fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Critic JSON (skip IDs in already_fixed and skipped): " + critic_json + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style (no new comment noise). Do not weaken tests. Prefer fail-closed.\n";
rules += "Tap facts: CAPTURED means capture succeeded; VOID means the hold was released. ACCEPTED refund is pending, not failed.\n";
rules += "Do not require tapCustomer.lastName. Do not add CaptureParams.callbackUrl. Do not default auto VOID hours.\n";

let p_a = rules;
p_a += "STREAM A — GATEWAY + CONFIG + TESTS. OWN ONLY:\n";
p_a += "- packages/gateway-tap/src/gateway.ts\n";
p_a += "- packages/gateway-tap/src/gateway.test.ts\n";
p_a += "- packages/gateway-tap/src/config.ts\n";
p_a += "- packages/gateway-tap/src/factory.test.ts\n";
p_a += "- packages/gateway-tap/src/types.ts\n";
p_a += "Do NOT edit status.ts, http.ts, sources.ts, webhooks.ts, money.ts, docs, README, CHANGELOG, factory.ts, factory.types.test.ts.\n";
p_a += "FIX TAP-CAPTURE-STATUS: After GET authorize, allow AUTHORIZED (normal capture) and CAPTURED (crash-retry: still POST /charges with the same reference.idempotent so Tap returns the original charge). REJECT VOID and every other status with InvalidRequestError before POST /charges (message mentions authorize status). REPLACE the existing test that replays VOID: VOID must throw InvalidRequestError and must not POST /charges (only the GET). ADD a test: GET authorize status CAPTURED then POST /charges succeeds and result is paid. Keep INITIATED reject test. Keep happy-path AUTHORIZED capture.\n";
p_a += "FIX TAP-CAPTURE-FIELDS: capture POST body always includes threeDSecure: true and customer_initiated: true. Test the capture happy-path JSON for both.\n";
p_a += "FIX TAP-AUTHORIZE-AUTO: TapConfig.autoVoidHours optional finite number 1..168 inclusive. copyTapConfig copies it after assert. Invalid values throw InvalidRequestError. factory.test.ts: autoVoidHours 0, 169, NaN throw; 1 and 168 accepted. When capture:false AND autoVoidHours set, authorize POST body includes auto:{type:\"VOID\",time:autoVoidHours}. When unset, omit auto. Charges (capture true) never send auto. Test both.\n";
p_a += "FIX TAP-AUTHORIZE-SOURCE: when params.tapSource is omitted AND p.capture === false, source id is src_card (not src_all). When tapSource is provided, use resolveTapSourceId as today. When capture is true/omitted and tapSource omitted, keep src_all. Test capture:false omitted source posts source.id src_card; default create still src_all.\n";
p_a += "FIX TAP-CREATE-AUTH-SOURCE: createPayment must reject source ids starting with auth_ (case-insensitive) with InvalidRequestError telling the caller to use capturePayment. capturePayment still uses auth_ ids. Test createPayment tapSource:{id:auth_testAuthorize01} throws and does not fetch.\n";
p_a += "FIX TAP-ZERO-AMOUNT: outbound create/capture/refund amounts must be > 0. After tapMajorNumber for the request body, if the number is 0 throw InvalidRequestError. Do not change money.ts. Test createPayment amount money(0,SAR) throws before fetch.\n";
p_a += "If types.ts needs TapConfig autoVoidHours, that field lives on config.ts (you own it). types.ts: add ACCEPTED to TapRefundStatus union so Stream B is not blocked on the type; Stream B owns the mapping.\n";

let p_b = rules;
p_b += "STREAM B — STATUS, HTTP. OWN ONLY:\n";
p_b += "- packages/gateway-tap/src/status.ts\n";
p_b += "- packages/gateway-tap/src/status.test.ts\n";
p_b += "- packages/gateway-tap/src/http.ts\n";
p_b += "- packages/gateway-tap/src/http.test.ts\n";
p_b += "Do NOT edit gateway.ts, types.ts, config.ts, sources.ts, webhooks.ts, money.ts, docs, README, CHANGELOG, tests in gateway.test.ts.\n";
p_b += "FIX TAP-REFUND-ACCEPTED: REFUND_STATUS ACCEPTED = pending (same as PENDING / IN PROGRESS). mapTapRefundPaymentStatus(ACCEPTED) is refund_pending. mapTapRefundEntityStatus(ACCEPTED) is pending. Test those. Do not treat ACCEPTED as completed.\n";
p_b += "FIX TAP-AUTH-LEFTOVER-URL: mapTapPaymentOutcome must NOT return requires_action for leftover transaction.url unless payment status is pending. failed/cancelled stay failed; authorized/paid stay succeeded (paid already special-cased). Test mapTapChargeOutcome(AUTHORIZED, authorized, https://checkout.example) is succeeded. Keep INITIATED without url as requires_action. Keep DECLINED as declined. Keep CAPTURED leftover url as succeeded.\n";
p_b += "FIX TAP-IN-PROGRESS-UNDERSCORE: CHARGE_STATUS and REFUND_STATUS must map both \"IN PROGRESS\" and \"IN_PROGRESS\" to pending. Test mapTapChargeStatus(IN_PROGRESS) is pending and outcome with a url is requires_action.\n";
p_b += "FIX TAP-CHARGE-CANCELED: CHARGE_STATUS CANCELED (one L) = cancelled, same as CANCELLED.\n";
p_b += "FIX TAP-HTTP-50X: mapTapHttpFailure must NOT map errors[].code 501-516 / startsWith 50 to CardDeclinedError. Those are Tap object response codes on 2xx bodies (already handled in gateway mapPaymentObject). Keep 505 as InsufficientFundsError only if you can prove Tap returns it as an HTTP error code; otherwise drop it from the HTTP mapper too and leave 2xx mapping in gateway.ts. Keep AUTH/NOT_FOUND/AMOUNT/1151/5xx behavior. Test: POST 400 errors code 504 is NOT CardDeclinedError (GatewayApiError or InvalidRequestError). POST 400 code 501 is not CardDeclinedError.\n";
p_b += "FIX TAP-1106-CUSTOMER: remove 1106 from NOT_FOUND_CODES. Map 1106 to InvalidRequestError (customer not found is a bad customer id, not a missing charge). Test POST/GET 400 code 1106 is InvalidRequestError not ResourceNotFoundError. Keep 1144/1115/1160/2102 as not found.\n";
p_b += "FIX TAP-1114-STATUS: code 1114 maps to InvalidRequestError (Please check the Authorize status). Test POST 400 1114 is InvalidRequestError.\n";
p_b += "FIX TAP-AMOUNT-RAW if still present: AMOUNT_CODES InvalidRequestError should pass raw {status,body,code} like sibling mappings.\n";

let p_d = rules;
p_d += "STREAM C — DOCS + CHANGELOG. OWN ONLY:\n";
p_d += "- packages/gateway-tap/docs/authorize.md\n";
p_d += "- packages/gateway-tap/docs/charges.md\n";
p_d += "- packages/gateway-tap/docs/refunds.md\n";
p_d += "- packages/gateway-tap/docs/status-mapping.md\n";
p_d += "- packages/gateway-tap/docs/idempotency.md\n";
p_d += "- packages/gateway-tap/docs/production-checklist.md\n";
p_d += "- packages/gateway-tap/docs/overview.md\n";
p_d += "- packages/gateway-tap/README.md\n";
p_d += "- packages/gateway-tap/CHANGELOG.md\n";
p_d += "Do NOT edit packages/gateway-tap/src/** at all.\n";
p_d += "Docs must match the INTENDED fixed behavior (after streams A/B):\n";
p_d += "authorize.md: capture requires GET authorize AUTHORIZED (normal) or CAPTURED (idempotent replay of POST /charges with the same idempotencyKey). VOID is rejected. Capture POST sends threeDSecure true and customer_initiated true. capture:false omitted source defaults src_card. Optional config autoVoidHours sends auto VOID on authorize create only.\n";
p_d += "charges.md: omitted tapSource is src_all. createPayment rejects auth_ source ids (use capturePayment). Amount must be > 0.\n";
p_d += "refunds.md: object ACCEPTED is pending / refund_pending, not failed. Do not fulfill or retry as failure.\n";
p_d += "status-mapping.md: CAPTURED authorize is paid (getPayment) / capture replay; VOID is cancelled and not capturable. ACCEPTED refund pending. IN PROGRESS and IN_PROGRESS both pending. Leftover transaction.url on AUTHORIZED/CAPTURED is not requires_action.\n";
p_d += "production-checklist.md: do not capture VOID auths; reconcile CAPTURED authorize via getPayment or replay capture with the same idempotencyKey; ACCEPTED refunds are in progress.\n";
p_d += "CHANGELOG Unreleased Patch bullets TAP-CAPTURE-STATUS, TAP-REFUND-ACCEPTED, TAP-AUTH-LEFTOVER-URL, TAP-CAPTURE-FIELDS, TAP-AUTHORIZE-AUTO, TAP-AUTHORIZE-SOURCE, TAP-CREATE-AUTH-SOURCE, TAP-IN-PROGRESS-UNDERSCORE, TAP-HTTP-50X, TAP-1106-CUSTOMER, TAP-ZERO-AMOUNT, TAP-1114-STATUS. Rewrite the TAP-CAPTURE-BODY line so it no longer says VOID replays capture.\n";
p_d += "README: mention capture:false default source src_card; optional autoVoidHours.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:tap-r2-gateway", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:tap-r2-status-http", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:tap-r2-docs", capability_mode: "all", output_schema: fix_schema },
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
p_v += "   - capturePayment allows AUTHORIZED and CAPTURED; VOID throws before POST /charges\n";
p_v += "   - gateway.test.ts does NOT replay VOID as success; DOES replay CAPTURED\n";
p_v += "   - REFUND_STATUS ACCEPTED is pending\n";
p_v += "   - mapTapChargeOutcome AUTHORIZED + leftover url is succeeded\n";
p_v += "   - capture POST JSON includes threeDSecure and customer_initiated\n";
p_v += "   - capture:false omitted source is src_card; default create is src_all\n";
p_v += "   - createPayment rejects auth_ source\n";
p_v += "   - 1106 is not in NOT_FOUND_CODES\n";
p_v += "   - mapTapHttpFailure 504 is not CardDeclinedError\n";
p_v += "   - CHARGE_STATUS has IN_PROGRESS\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass AND invariants hold.\n";

let verify = agent(p_v, #{
    label: "verify:tap-r2-tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Tap r2 blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence AND a test exists for each blocking ID.\n";
p_g += "BLOCKERS:\n";
p_g += "TAP-CAPTURE-STATUS: VOID capture throws before POST; CAPTURED capture POSTs /charges (replay). Tests exist for both. CHANGELOG/docs must not still say VOID replays capture.\n";
p_g += "TAP-REFUND-ACCEPTED: ACCEPTED -> pending / refund_pending. Test exists.\n";
p_g += "TAP-AUTH-LEFTOVER-URL: AUTHORIZED + transaction.url is succeeded not requires_action. Test exists (status.test.ts and/or gateway.test.ts).\n";
p_g += "TAP-CAPTURE-FIELDS: capture body threeDSecure true and customer_initiated true. Test exists.\n";
p_g += "TAP-AUTHORIZE-SOURCE: capture:false default source src_card. Test exists.\n";
p_g += "TAP-CREATE-AUTH-SOURCE: createPayment auth_ source throws. Test exists.\n";
p_g += "TAP-IN-PROGRESS-UNDERSCORE: IN_PROGRESS pending. Test exists.\n";
p_g += "TAP-HTTP-50X: HTTP 400 code 504 is not CardDeclinedError. Test exists.\n";
p_g += "TAP-1106-CUSTOMER: 1106 is InvalidRequestError. Test exists.\n";
p_g += "TAP-ZERO-AMOUNT: create amount 0 throws before fetch. Test exists.\n";
p_g += "TAP-AUTHORIZE-AUTO: autoVoidHours optional 1..168; authorize body auto VOID only when set. Tests exist. Must NOT default auto VOID when unset.\n";
p_g += "TAP-1114-STATUS: 1114 is InvalidRequestError. Test exists.\n";
p_g += "Non-blocking allowed: TAP-LAST-NAME, TAP-CAPTURE-REDIRECT, TAP-AMOUNT-RAW leftover, TAP-CHARGE-CANCELED leftover.\n";
p_g += "Return {pass, blocking, non_blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:tap-r2-adversarial",
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
    log("Remediating remaining Tap r2 blockers");
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
        blockers += "Gate missing or failed closed. Re-read TAP-CAPTURE-STATUS, TAP-REFUND-ACCEPTED, TAP-AUTH-LEFTOVER-URL, TAP-CAPTURE-FIELDS, TAP-AUTHORIZE-SOURCE, TAP-CREATE-AUTH-SOURCE, TAP-IN-PROGRESS-UNDERSCORE, TAP-HTTP-50X, TAP-1106-CUSTOMER, TAP-ZERO-AMOUNT, TAP-AUTHORIZE-AUTO, TAP-1114-STATUS and fix any still present.\n";
    }

    let p_r = "";
    p_r += "Repo: " + root + "\n";
    p_r += "Do NOT commit or push. You may edit packages/gateway-tap/** only.\n";
    p_r += "REMEDIATE remaining Tap r2 review blockers with tests. Then run:\n";
    p_r += "bun run --filter @paykernel/gateway-tap typecheck && bun run --filter @paykernel/gateway-tap typecheck:types && bun test packages/gateway-tap\n";
    p_r += "Tap facts: CAPTURED=captured hold; VOID=voided hold (not capturable). ACCEPTED refund=pending. Do not default auto VOID. Do not require lastName.\n";
    p_r += "Blockers:\n";
    p_r += blockers;
    p_r += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_r, #{
        label: "remediate:tap-r2-blockers",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    log("Remediate: " + safe_summary(rem));

    let p_v2 = "";
    p_v2 += "Re-verify " + root + " after Tap r2 remediation.\n";
    p_v2 += "Run bun run --filter @paykernel/gateway-tap typecheck && bun run --filter @paykernel/gateway-tap typecheck:types && bun test packages/gateway-tap.\n";
    p_v2 += "Re-check blocking invariants: VOID capture throws; CAPTURED capture replays POST; ACCEPTED pending; AUTHORIZED leftover url succeeded; src_card on authorize default; auth_ rejected on create; 1106 InvalidRequestError; HTTP 504 not CardDeclinedError; autoVoidHours optional not defaulted.\n";
    p_v2 += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}.\n";
    let ver2 = agent(p_v2, #{
        label: "verify:tap-r2-post-remediate",
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
    p_g2 += "READ-ONLY re-gate of " + root + " after Tap r2 remediation. Fail closed. pass=true only if TAP-CAPTURE-STATUS, TAP-REFUND-ACCEPTED, TAP-AUTH-LEFTOVER-URL, TAP-CAPTURE-FIELDS, TAP-AUTHORIZE-SOURCE, TAP-CREATE-AUTH-SOURCE, TAP-IN-PROGRESS-UNDERSCORE, TAP-HTTP-50X, TAP-1106-CUSTOMER, TAP-ZERO-AMOUNT, TAP-AUTHORIZE-AUTO, TAP-1114-STATUS are gone with file:line + tests. VOID must not replay capture. ACCEPTED must not be failed.\n";
    p_g2 += "Return {pass, blocking, non_blocking, summary}.\n";
    let gate2 = agent(p_g2, #{
        label: "gate:tap-r2-post-remediate",
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
p_rep += "Write a concise Tap r2 fix-gate report via write_scratch_file name phase-23-tap-r2-fix-gate.md (do NOT create docs/audits).\n";
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
    label: "report:tap-r2-fix-gate",
    capability_mode: "all",
    output_schema: report_schema,
});
log("Report: " + safe_summary(report));

complete(#{
    summary: "Tap r2 fix-gate finished. final_pass=" + final_pass.to_string() + " gate_pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + ". " + safe_summary(report),
    final_pass: final_pass,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
});
