let meta = #{
    name: "phase-22-review-fix-gate",
    description: "Critic, fix, verify, and adversarially gate Phase 22 review findings (checkout 404, list freeze, docs, payment-link money)",
    phases: [
        #{ title: "Critic", detail: "reconfirm every P22 ID against current code" },
        #{ title: "Fix", detail: "three non-overlapping streams for confirmed findings" },
        #{ title: "Verify", detail: "typecheck plus core/testkit tests and invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "write gate report" },
    ],
    when_to_use: "After a Phase 22 production review; critic then fix then verify then gate checkout GET 404, list identity freeze, stale stripe.md, payment-link GET money",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
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
log("Confirming Phase 22 review findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "P22-CKO-404: StripeGateway.getCheckoutSession does not catch 404 via stripeNotFoundFailed. getCustomer/getDispute/getPaymentLink return {outcome:failed,error.statusCode:404}. getCheckoutSession throws GatewayApiError. Evidence expected around stripe.gateway.ts getCheckoutSession vs stripeNotFoundFailed callers.\n";
p_c += "P22-FREEZE-LIST: MONEY_IDENTITY_KEYS includes disputes and paymentMethods but NESTED_IDENTITY_KEYS does not. shallowCloneResult shares the array; after-hooks can mutate disputes[0]/paymentMethods[0] in place. money-identity.ts.\n";
p_c += "P22-DOCS-SHAPE: packages/core/docs/stripe.md still documents session.sessionId, session.paymentIntentId, and createCheckoutSession success:true. Actual CheckoutSessionOperationResult uses session.references.providerObjectId and relatedIds.paymentIntentId; outcome succeeded not success true. hosted-checkout.md is the correct shape.\n";
p_c += "P22-LINK-AMOUNT: createPaymentLink copies amount/currency from the request onto the snapshot. getPaymentLink/deactivatePaymentLink mapStripePaymentLink only id/url/active — GET drops money fields. StripePaymentLinkObject has no amount. May need expand[]=line_items on GET, mapped fail-closed (single line item with finite unit_amount+currency; omit if missing/many).\n";
p_c += "P22-CURRENCY: getCheckoutSession stores stripeCurrencyCode lowercase; mapStripeDispute / webhooks uppercase ISO. CheckoutSession.currency tests may expect usd.\n";
p_c += "P22-GET-FLAG: mapStripePaymentLink missing id/url uses throwStripeIndeterminateResponse (NetworkError afterProviderSubmit:true). GET getPaymentLink is not a mutation; getCheckoutSession missing id throws NetworkError WITHOUT afterProviderSubmit.\n";
p_c += "P22-DASH-URL: stripeDisputeDashboardUrl uses STRIPE_CHARGE_ID_PATTERN; disputeFromWebhookEvent uses chargeId.startsWith(ch_). Duplicate dashboard URL construction.\n";
p_c += "P22-NATIVE-STATUS: mapStripePaymentLink providerNativeStatus equals domain active/inactive, not Stripe active boolean.\n";
p_c += "P22-CKO-CREATE-AMOUNT: createCheckoutSession succeeded snapshot omits amount/currency even when Stripe returns amount_total.\n";
p_c += "P22-MOCK-QUEUE: testkit mock createCheckoutSession/getDispute/createPaymentLink always succeed and ignore scripted FIFO queues. Comment says claim_method_presence. Mark already_fixed or non-blocking unless you find callers that script those ops and get ignored.\n";
p_c += "Return confirmed[] as ID strings, already_fixed[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:phase-22",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Three non-overlapping Phase 22 fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style. Do not weaken tests. Prefer fail-closed. Skip IDs critic marked ALREADY FIXED.\n";
rules += "Do not touch Moyasar/PayPal/Paymob adapters, routing, reconciliation, or store packages.\n";

let p_a = rules;
p_a += "STREAM A — STRIPE ADAPTER. OWN ONLY:\n";
p_a += "- packages/core/src/gateways/stripe/stripe.gateway.ts\n";
p_a += "- packages/core/src/gateways/stripe/stripe.gateway.test.ts\n";
p_a += "- packages/core/src/gateways/stripe/stripe.payment-links.test.ts\n";
p_a += "- packages/core/src/gateways/stripe/stripe.disputes.test.ts\n";
p_a += "Copy the getCustomer 404 pattern from stripe.customers.test.ts (createMockResponse error body, false, 404 -> outcome failed, error.code GATEWAY_API_ERROR).\n";
p_a += "FIX P22-CKO-404: wrap getCheckoutSession stripeRequest in try/catch; stripeNotFoundFailed return; else rethrow. Add test getCheckoutSession 404 is a failed outcome, not a throw.\n";
p_a += "FIX P22-GET-FLAG: GET getPaymentLink must not mark missing id/url as afterProviderSubmit. Keep throwStripeIndeterminateResponse / requireStripeMutationId on CREATE (post-submit). On GET, missing id: throw new NetworkError(...) without afterProviderSubmit (match getCheckoutSession). Missing url on GET: same, or outcome failed — do not claim post-submit. Split mapper vs GET path if needed. Add a test that a 200 body without url on getPaymentLink throws NetworkError and the error afterProviderSubmit is not true.\n";
p_a += "FIX P22-LINK-AMOUNT: getPaymentLink (and deactivate if the response is a Payment Link object) should recover amount+currency when Stripe exposes a single line item. GET with expand[]=line_items. Map only when exactly one line item has finite unit_amount (price.unit_amount or line amount) AND a currency; convert via fromStripeAmount; uppercase currency. Omit money if 0/many/unobservable — never invent 0. Keep createPaymentLink request copy as fallback when the create response has no line items. Tests: GET expanded single line item publishes amount/currency; GET without line items omits amount.\n";
p_a += "FIX P22-CURRENCY: CheckoutSession.currency on get AND create must be uppercase ISO like disputes/webhooks (currency.toUpperCase() after stripeCurrencyCode). Update stripe.gateway.test.ts expects from usd to USD.\n";
p_a += "FIX P22-NATIVE-STATUS: providerNativeStatus on payment links should be the Stripe native active flag as a string (true/false), while status stays active/inactive from active===true fail-closed. Update tests if they asserted providerNativeStatus===status.\n";
p_a += "FIX P22-CKO-CREATE-AMOUNT: when createCheckoutSession HTTP 200 has finite amount_total and currency, publish session.amount + uppercase session.currency (fromStripeAmount). Omit if currency missing. Do not invent 0. Add/adjust a create test.\n";
p_a += "Do NOT edit money-identity.ts or docs in this stream.\n";

let p_b = rules;
p_b += "STREAM B — AFTER-HOOK LIST FREEZE. OWN ONLY:\n";
p_b += "- packages/core/src/hooks/money-identity.ts\n";
p_b += "- packages/core/src/hooks/money-identity.test.ts\n";
p_b += "FIX P22-FREEZE-LIST: add paymentMethods and disputes to NESTED_IDENTITY_KEYS (arrays of identity objects). shallowCloneResult / detachNestedIdentityFields / restoreMoneyIdentityFields already deepClonePlain nested keys — arrays are handled by deepClonePlain. After restore, hook in-place mutation of disputes[0].amount or paymentMethods[0].id must not stick; restored nested items must not be the same reference as the hook clone.\n";
p_b += "Add tests next to NEW-CORE-7: list disputes and paymentMethods in-place nested mutation does not poison original or restored result; hook-replaced array is restored from original via deep clone (not shared refs).\n";
p_b += "Do not change MONEY_IDENTITY_KEYS membership except if a list key is missing (it should already include disputes and paymentMethods).\n";

let p_d = rules;
p_d += "STREAM C — DOCS + WEBHOOK DASHBOARD ALIGNMENT. OWN ONLY:\n";
p_d += "- packages/core/docs/stripe.md\n";
p_d += "- packages/core/docs/hosted-checkout.md (only if still stale)\n";
p_d += "- packages/core/docs/payment-links.md\n";
p_d += "- packages/core/docs/disputes.md (only if dashboard/status wording is wrong)\n";
p_d += "- resources/gateways/stripe/README.md (paymentIntentId wording; canonical is core docs/stripe.md)\n";
p_d += "- packages/core/src/types/payment-event.ts\n";
p_d += "- packages/core/src/disputes.acceptance.test.ts only if dashboard URL assertion must stay valid\n";
p_d += "FIX P22-DOCS-SHAPE: stripe.md getCheckoutSession snippet must use result.outcome, result.session.references.providerObjectId, result.session.references.relatedIds.paymentIntentId, result.session.url/status/paymentStatus/amount. Delete session.sessionId / session.paymentIntentId / createCheckoutSession may still return success:true. Align the indeterminate paragraph: lookup id lives on session.references.providerObjectId (idempotency key or unknown), not a top-level sessionId. Mention getCheckoutSession 404 is outcome failed like getCustomer (once Stream A lands; write the intended contract).\n";
p_d += "FIX P22-LINK-AMOUNT docs: payment-links.md must say create may copy request money; GET publishes amount/currency only from an expanded single line item and omits them otherwise.\n";
p_d += "FIX P22-DASH-URL: in disputeFromWebhookEvent, use the same charge-id rule as STRIPE_CHARGE_ID_PATTERN /^ch_[A-Za-z0-9_]+$/ instead of startsWith(ch_). Do NOT import stripe.gateway.ts (cycle). Inline the regex or a tiny local helper in payment-event.ts. Keep livemode host test vs live. Do not change other webhook mapping.\n";
p_d += "Do not edit stripe.gateway.ts or money-identity.ts.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:stripe-adapter", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:list-freeze", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:docs-dashboard", capability_mode: "all", output_schema: fix_schema },
]);

let fi = 0;
for f in fixes {
    log("Fix stream " + fi.to_string() + ": " + safe_summary(f));
    fi += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Typecheck and targeted Phase 22 tests");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root. Paste relevant fail lines in failures[].\n";
p_v += "1) bun run --filter @paykernel/core typecheck\n";
p_v += "2) bun run --filter @paykernel/core typecheck:types if that script exists; otherwise skip and note it\n";
p_v += "3) bun test packages/core/src/gateways/stripe packages/core/src/hooks/money-identity.test.ts packages/core/src/checkout.acceptance.test.ts packages/core/src/disputes.acceptance.test.ts packages/core/src/payment-links.acceptance.test.ts packages/core/src/public-api.test.ts packages/core/src/public-api.types.test.ts packages/testkit/src/mock/mock-gateway.test.ts\n";
p_v += "4) Grep/read invariants (must hold):\n";
p_v += "   - getCheckoutSession uses stripeNotFoundFailed\n";
p_v += "   - NESTED_IDENTITY_KEYS includes disputes and paymentMethods\n";
p_v += "   - stripe.md does not mention session.sessionId or success: true for checkout create/get\n";
p_v += "   - getPaymentLink GET expand or line-item money mapping exists OR docs honestly omit; create vs get money must not silently disagree without docs\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass.\n";

let verify = agent(p_v, #{
    label: "verify:tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Phase 22 blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence.\n";
p_g += "BLOCKERS:\n";
p_g += "P22-CKO-404: getCheckoutSession 404 returns outcome failed via stripeNotFoundFailed; test exists.\n";
p_g += "P22-FREEZE-LIST: NESTED_IDENTITY_KEYS includes disputes and paymentMethods; test proves in-place nested mutation does not stick.\n";
p_g += "P22-DOCS-SHAPE: stripe.md checkout get/create snippets use outcome + references.providerObjectId + relatedIds.paymentIntentId; no session.sessionId; no success:true as the create return shape.\n";
p_g += "P22-LINK-AMOUNT: GET either publishes fail-closed single-line-item money or docs state omission; create-vs-get must not lie. Test covers the chosen behavior.\n";
p_g += "P22-GET-FLAG: getPaymentLink missing url/id is not NetworkError afterProviderSubmit:true.\n";
p_g += "P22-CURRENCY: CheckoutSession.currency uppercase when published.\n";
p_g += "Non-blocking allowed: P22-MOCK-QUEUE (claim stubs); leftover dashboard helper not extracted into a shared module if regex is aligned; providerNativeStatus true/false vs active if status domain remains fail-closed active===true.\n";
p_g += "Return {pass, blocking, non_blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:adversarial",
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
    log("Remediating remaining Phase 22 blockers");
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
        blockers += "Gate missing or failed closed. Re-read P22-CKO-404 P22-FREEZE-LIST P22-DOCS-SHAPE P22-LINK-AMOUNT P22-GET-FLAG P22-CURRENCY and fix any still present.\n";
    }

    let p_r = rules;
    p_r += "REMEDIATE remaining Phase 22 blockers. You may edit packages/core/src/gateways/stripe, packages/core/src/hooks/money-identity.ts, packages/core/src/hooks/money-identity.test.ts, packages/core/docs/stripe.md, packages/core/docs/payment-links.md, packages/core/docs/hosted-checkout.md, packages/core/src/types/payment-event.ts, resources/gateways/stripe/README.md, and the stripe/dispute/payment-link tests.\n";
    p_r += "Do not commit. Do not expand into other packages except @paykernel/core docs/tests listed.\n";
    p_r += "Blockers:\n";
    p_r += blockers;
    p_r += "Fix them with tests. Then run bun run --filter @paykernel/core typecheck and bun test on the touched test files.\n";
    p_r += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_r, #{
        label: "remediate:blockers",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    log("Remediate: " + safe_summary(rem));

    let p_v2 = "";
    p_v2 += "Re-verify " + root + " after remediation.\n";
    p_v2 += "Run bun run --filter @paykernel/core typecheck and bun test packages/core/src/gateways/stripe packages/core/src/hooks/money-identity.test.ts packages/core/src/checkout.acceptance.test.ts packages/core/src/disputes.acceptance.test.ts packages/core/src/payment-links.acceptance.test.ts packages/core/src/public-api.test.ts.\n";
    p_v2 += "Re-check blocking invariants from the gate list. Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}.\n";
    let ver2 = agent(p_v2, #{
        label: "verify:post-remediate",
        capability_mode: "execute",
        output_schema: verify_schema,
    });
    log("Post-remediate verify: " + safe_summary(ver2));
    if ver2 != () && ver2.success && ver2.output != () && ver2.output.ok == true {
        verify_ok = true;
    }

    let p_g2 = "";
    p_g2 += "Quick re-gate of " + root + " after remediation. READ-ONLY. Read code for remaining Phase 22 blockers only.\n";
    p_g2 += "pass=true only if no blocking IDs remain. Return {pass, blocking, non_blocking, summary}.\n";
    let gate2 = agent(p_g2, #{
        label: "gate:post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    log("Post-remediate gate: " + safe_summary(gate2));
    if gate2 != () && gate2.success && gate2.output != () && gate2.output.pass == true {
        gate_pass = true;
    } else if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = false;
    }
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
log("Writing Phase 22 review fix-gate report");

let p_rep = "";
p_rep += "Write a gate report to " + root + "/docs/audits/phase-22-review-fix-gate.md\n";
p_rep += "Repo: " + root + "\n";
p_rep += "Use read_file/grep plus critic/fix/verify/gate outcomes. Be honest. Do not claim PASS without file:line evidence.\n";
p_rep += "Include: verdict, per-ID table (P22-CKO-404 P22-FREEZE-LIST P22-DOCS-SHAPE P22-LINK-AMOUNT P22-CURRENCY P22-GET-FLAG P22-DASH-URL P22-NATIVE-STATUS P22-CKO-CREATE-AMOUNT P22-MOCK-QUEUE), typecheck/tests, remaining nits.\n";
p_rep += "Keep it short. Match docs/audits style if a recent session-audit fix-result exists.\n";
p_rep += "Return {ok, report_path, summary}.\n";

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
    summary: "Phase 22 critic/fix/verify/gate finished. Gate pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + ". " + safe_summary(report),
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    report_path: report_path,
    critic: safe_summary(critic),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
});
