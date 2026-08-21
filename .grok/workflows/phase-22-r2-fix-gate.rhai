let meta = #{
    name: "phase-22-r2-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every remaining Phase 22 review finding (checkout GET zero, list truncation, PCI fence, PayPal disputes, lookup ids, docs)",
    phases: [
        #{ title: "Critic", detail: "reconfirm every P22-r2 ID against current code" },
        #{ title: "Fix", detail: "four non-overlapping streams for confirmed findings" },
        #{ title: "Verify", detail: "typecheck plus core/testkit tests and invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "scratch gate report" },
    ],
    when_to_use: "After the Phase 22 deep review; critic then fix then verify then gate GET-zero, list truncation, PCI fence, PayPal dispute parse, indeterminate lookup, README",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
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
log("Confirming Phase 22 r2 review findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "Round-1 IDs already closed in a9fc2ed (CKO-404, FREEZE-LIST, LINK-AMOUNT, CURRENCY, GET-FLAG on payment-link GET, DOCS-SHAPE in hosted-checkout.md) — mark already_fixed unless they regressed.\n";
p_c += "BLOCKING (must confirm or already_fixed):\n";
p_c += "P22-CKO-GET-ZERO: getCheckoutSession expand[]=payment_intent. stripeCheckoutPublishedAmountMinor uses resolveStripeCapturedMinor which returns amount_received even when 0. Unpaid open session with expanded PI amount_received:0 publishes amount 0 instead of amount_total. Create uses amount_total. Evidence: stripe.gateway.ts resolveStripeCapturedMinor, stripeCheckoutPublishedAmountMinor, getCheckoutSession. Tests mock PI as {id} without amount_received.\n";
p_c += "P22-LIST-TRUNC: listPaymentMethods GET /v1/payment_methods?customer= with no limit/starting_after; has_more ignored. Stripe default page size 10. outcome succeeded with a partial vault. listDisputes same page cap (payment-bound). Refunds already paginate limit=100.\n";
p_c += "P22-PCI-FENCE: raw-card.ts only string number/pan/cardNumber plus nested card and source.type===creditcard. Does not walk metadata, uncategorizedText, stripeEvidence values, cvc/cvv, numeric PAN, token. Stripe createCustomer posts metadata; submitDisputeEvidence posts evidence text. Fence runs on PaymentClient before before-hooks.\n";
p_c += "P22-PP-DISPUTE: disputes.md says PayPal CUSTOMER.DISPUTE.* dual-writes dispute.* . Catalog maps them in webhook-event-map.ts. parseWebhookEvent throws Unsupported PayPal webhook event when mapWebhookStatus returns undefined. Test paypal.gateway.test.ts expects the throw.\n";
p_c += "IMPORTANT:\n";
p_c += "P22-IND-LOOKUP: isPostSubmitCustomerMutation returns {outcome, reconciliationRequired, message} only. providerObjectIdFromParams is unused. Checkout create uses applyIndeterminateCheckoutSessionOutcome with lookup id.\n";
p_c += "P22-OFFSESSION-CUS: client off-session check requires paymentMethodId/stripePaymentMethodId only, not customerId. Stripe adapter same. Stripe off_session typically needs customer.\n";
p_c += "P22-CKO-CREATE-PI: createCheckoutSession does not map response.payment_intent onto session.references.relatedIds. GET does after expand.\n";
p_c += "P22-EMPTY-CUS: mapStripePaymentMethod customerId fallback ?? empty string when Stripe customer is null and caller omitted customerId.\n";
p_c += "P22-GET-FLAG-2: mapStripeCustomer/mapStripeDispute use requireStripeMutationId (afterProviderSubmit:true) on GET paths. getCheckoutSession missing id throws NetworkError without that flag.\n";
p_c += "P22-MOCK: testkit queues only create/capture/refund/void/getPayment. Phase 22 methods always succeed; listPaymentMethods always [].\n";
p_c += "P22-README: packages/core/README.md createCheckoutSession sample assigns a session object, omits idempotencyKey, does not discriminate outcome. stripe.md similar.\n";
p_c += "P22-SUB-ID: subscription checkout webhooks prefer gatewayPaymentId=sub_*; capture/refund require pi_*. Docs must say so. Do not change ID preference unless tests prove it is wrong.\n";
p_c += "NON-BLOCKING (confirm or skip): P22-CKO-STATUS (GET rematch to processing without charge snapshot — fail-closed; expanding latest_charge is optional honesty), P22-ENVELOPE (WebhookEvent.status typed PaymentStatus while dispute events write needs_response — documented last-write footgun), P22-CLONE (deep clone rawResponse under nested identity — perf only), P22-LOG-PAN (logger string-only PAN).\n";
p_c += "Return confirmed[] as ID strings, already_fixed[], skipped[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:phase-22-r2",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Four non-overlapping Phase 22 r2 fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style. Do not weaken tests. Prefer fail-closed. Skip IDs the critic marked ALREADY FIXED.\n";
rules += "Never invent major 0. Never treat checkout create success as paid. Never last-write dispute envelope onto payment pending/paid incorrectly.\n";

let p_a = rules;
p_a += "STREAM A — STRIPE ADAPTER. OWN ONLY:\n";
p_a += "- packages/core/src/gateways/stripe/stripe.gateway.ts\n";
p_a += "- packages/core/src/gateways/stripe/stripe.gateway.test.ts\n";
p_a += "- packages/core/src/gateways/stripe/stripe.customers.test.ts\n";
p_a += "- packages/core/src/gateways/stripe/stripe.disputes.test.ts\n";
p_a += "- packages/core/src/gateways/stripe/stripe.payment-links.test.ts\n";
p_a += "Do NOT edit raw-card.ts, client.ts, base.gateway.ts, paypal, docs, testkit, money-identity.ts.\n";
p_a += "FIX P22-CKO-GET-ZERO: stripeCheckoutPublishedAmountMinor must NOT use resolveStripeCapturedMinor(amount_received:0) for unpaid/open sessions. When payment_status is not paid (and not a proven $0 no_payment_required), publish amount_total (omit if missing — never invent 0). Use captured rematch only when payment_status is paid (or PI succeeded) and captured is a real settlement. Add a test: getCheckoutSession status open, payment_status unpaid, amount_total 1000, expanded PI {id, amount:1000, amount_received:0, currency:usd} publishes amount 10 / USD, NOT 0. Keep S19-CKO-GET paid+amount_received rematch tests.\n";
p_a += "FIX P22-LIST-TRUNC: listPaymentMethods must page Stripe (limit=100 + starting_after while has_more), same pattern as getTotalRefundedForPaymentIntent. Prefer GET /v1/customers/:id/payment_methods if that matches Stripe customer-list docs; keep customer bound. Do not silently return the first 10 as a complete succeeded list. Add a test with has_more true + two pages. listDisputes: either page the same way or document in a code comment that a PI/charge list is expected tiny; paging payment methods is required.\n";
p_a += "FIX P22-CKO-CREATE-PI: on createCheckoutSession HTTP 200, map expandableId(response.payment_intent) onto session.references.relatedIds.paymentIntentId when present (string or expanded object). Add/adjust a create test.\n";
p_a += "FIX P22-OFFSESSION-CUS (adapter half): when offSession===true, require customerId or stripeCustomerId (assertStripeCustomerId) in addition to payment method id. Throw InvalidRequestError before POST. Test: off-session without customer does not fetch.\n";
p_a += "FIX P22-EMPTY-CUS: mapStripePaymentMethod must omit customerId key or refuse empty string — do not publish customerId:\"\". Detach tests that omit customerId must not expect empty string.\n";
p_a += "FIX P22-GET-FLAG-2: GET getCustomer/getDispute/list mapping missing id must throw NetworkError WITHOUT afterProviderSubmit (match getCheckoutSession / getPaymentLink GET). Keep requireStripeMutationId / throwStripeIndeterminateResponse on CREATE/ATTACH/SUBMIT mutations. Split GET mapper vs mutation mapper if needed. Test: GET 200 customer body without id is not afterProviderSubmit:true (throw or failed — not indeterminate mutation).\n";
p_a += "Optional honesty: getCheckoutSession may expand payment_intent.latest_charge in addition to payment_intent so paid GET can observe charge snapshots. Do not break id-only PI tests that expect processing. Unpaid GET-zero test is mandatory.\n";

let p_b = rules;
p_b += "STREAM B — PCI FENCE + CLIENT OFF-SESSION. OWN ONLY:\n";
p_b += "- packages/core/src/utils/raw-card.ts\n";
p_b += "- packages/core/src/utils/utils.test.ts (only if that is where PCI tests live; else add packages/core/src/utils/raw-card.test.ts)\n";
p_b += "- packages/core/src/client.ts\n";
p_b += "- packages/core/src/customers.acceptance.test.ts\n";
p_b += "- packages/core/src/disputes.acceptance.test.ts\n";
p_b += "- packages/core/src/payment-links.acceptance.test.ts\n";
p_b += "Do NOT edit stripe.gateway.ts, paypal, base.gateway.ts, mock-gateway, README, CHANGELOG.\n";
p_b += "FIX P22-PCI-FENCE: containsRawCardMaterial must reject PAN-like values on any string OR number leaf (13-19 digits after stripping spaces/dashes), including nested metadata, evidence.uncategorizedText, stripeEvidence values, token, paymentMethodId. Reject CVC-shaped keys (cvc, cvv, cid, securityCode, card.cvc) when the value looks like 3-4 digit CVC. Keep source.type===creditcard. Do not false-positive gateway ids (pm_, tok_, cus_, pi_, cs_, dp_, ch_, sk_, pk_). Add tests: metadata.pan PAN rejected; uncategorizedText PAN rejected; cvc-only rejected; numeric number field rejected; pm_ id not rejected.\n";
p_b += "Client already calls assertNoRawCardMaterial on createPayment/createCustomer/attach/checkout/evidence/link — keep those; walking nested metadata means existing calls cover metadata without new call sites. Evidence: walking params.evidence is enough if deep-walk is recursive.\n";
p_b += "FIX P22-OFFSESSION-CUS (client half): when offSession===true, require a customer id (customerId or stripeCustomerId non-empty) AND a stored payment method id. InvalidRequestError before adapter. Test next to the existing off-session-without-PM test.\n";

let p_d = rules;
p_d += "STREAM C — PAYPAL DISPUTES + DOCS. OWN ONLY:\n";
p_d += "- packages/core/src/gateways/paypal/paypal.gateway.ts\n";
p_d += "- packages/core/src/gateways/paypal/paypal.gateway.test.ts\n";
p_d += "- packages/core/docs/disputes.md\n";
p_d += "- packages/core/docs/hosted-checkout.md\n";
p_d += "- packages/core/docs/customers.md\n";
p_d += "- packages/core/docs/stripe.md\n";
p_d += "- packages/core/README.md\n";
p_d += "- packages/core/CHANGELOG.md\n";
p_d += "Do NOT edit stripe.gateway.ts, raw-card.ts, client.ts, base.gateway.ts, mock-gateway.\n";
p_d += "FIX P22-PP-DISPUTE: parseWebhookEvent must NOT throw on CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED. mapWebhookStatus (or a sibling branch) must return a dispute-lifecycle envelope status, never paid, never generic payment pending if you can use processing / needs_response / under_review / won / lost. Dual-write via existing attachPaymentEvent + catalog map (dispute.opened/updated/closed). gatewayObjectId/gatewayPaymentId = dispute resource id. Flip paypal.gateway.test.ts 'should reject unsupported non-payment events' into a dual-write test (stableType dispute.opened, not payment.succeeded, not throw). Keep throwing for truly unknown event types.\n";
p_d += "FIX P22-README: README Stripe Checkout sample must use outcome union (result.outcome === succeeded, result.session.url, references.providerObjectId) and require idempotencyKey. stripe.md createCheckoutSession snippet must assign the operation result, not a raw session, and show outcome discrimination (hosted-checkout.md is the canonical shape).\n";
p_d += "FIX P22-SUB-ID docs: hosted-checkout.md and stripe.md must say subscription-mode checkout.session.completed may set gatewayPaymentId to sub_*; capture/refund/void still require pi_* (resolve via getCheckoutSession relatedIds.paymentIntentId or getPayment). Do not change webhook ID mapping in this stream.\n";
p_d += "Docs P22-CKO-GET-ZERO: hosted-checkout.md getCheckoutSession amount is session amount_total while unpaid; captured rematch only after paid. Do not fulfill on GET checkout amount.\n";
p_d += "Docs P22-PCI: customers.md fence walks metadata/evidence/CVC not just top-level PAN keys.\n";
p_d += "CHANGELOG Unreleased: short bullets for GET-zero, list paging, PCI walk, PayPal dispute parse, off-session customer, checkout create paymentIntentId, README outcome sample.\n";
p_d += "P22-ENVELOPE: do not widen PaymentStatus. A one-line disputes.md reminder that event.status on dispute webhooks is dispute lifecycle — persist event.event.dispute, never last-write event.status onto a payment row.\n";

let p_e = rules;
p_e += "STREAM D — BASE INDETERMINATE + TESTKIT. OWN ONLY:\n";
p_e += "- packages/core/src/gateways/base.gateway.ts\n";
p_e += "- packages/core/src/gateways/base.gateway.test.ts\n";
p_e += "- packages/core/src/types/customer.types.ts (only if adding applyIndeterminateCustomerOutcome)\n";
p_e += "- packages/core/src/types/dispute.types.ts (only if adding applyIndeterminateDisputeOutcome)\n";
p_e += "- packages/core/src/types/payment-link.types.ts (only if adding applyIndeterminatePaymentLinkOutcome)\n";
p_e += "- packages/testkit/src/mock/mock-gateway.ts\n";
p_e += "- packages/testkit/src/mock/mock-gateway.test.ts\n";
p_e += "Do NOT edit stripe.gateway.ts, paypal, raw-card.ts, client.ts, README.\n";
p_e += "FIX P22-IND-LOOKUP: isPostSubmitCustomerMutation indeterminate results must include a lookup identity from providerObjectIdFromParams (idempotencyKey / customerId / paymentMethodId / disputeId / paymentLinkId) plus message + reconciliationRequired. Prefer typed helpers mirroring applyIndeterminateCheckoutSessionOutcome (status unknown, references.providerObjectId = lookup id, do not invent succeeded/open/active). createCustomer timeout -> customer? snapshot with unknown status; attach/detach -> paymentMethod?; submitDisputeEvidence -> dispute?; create/deactivate payment link -> paymentLink?. Add BaseGateway tests using a tiny test gateway that implements the optional methods and throws NetworkError afterProviderSubmit:true.\n";
p_e += "Also re-assert assertNoRawCardMaterial(finalParams) after before-hooks in executeWithHooks (import from utils/raw-card) so hooks cannot inject CHD after the client fence. If that import creates a cycle, skip and note it.\n";
p_e += "FIX P22-MOCK: Phase 22 methods must honor defaultOutcome throw/timeout/network_error (do not always succeed). Minimal: if defaultOutcome is a throw step, createCheckoutSession/createCustomer/getDispute/createPaymentLink/listPaymentMethods fail the same way createPayment would. Better: add queues + enqueue support for those ops without breaking existing claim_method_presence tests. listPaymentMethods must not always return [] when a queue/defaultOutcome says otherwise. Add a test that defaultOutcome timeout on createCheckoutSession is not a silent succeeded session.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:stripe-adapter", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:pci-client", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:paypal-docs", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_e, label: "fix:base-testkit", capability_mode: "all", output_schema: fix_schema },
]);

let fi = 0;
for f in fixes {
    log("Fix stream " + fi.to_string() + ": " + safe_summary(f));
    fi += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Typecheck and targeted Phase 22 r2 tests");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root. Paste relevant fail lines in failures[].\n";
p_v += "1) bun run --filter @paykernel/core typecheck\n";
p_v += "2) bun run --filter @paykernel/core typecheck:types\n";
p_v += "3) bun test packages/core/src/gateways/stripe packages/core/src/gateways/paypal/paypal.gateway.test.ts packages/core/src/gateways/base.gateway.test.ts packages/core/src/utils/raw-card.ts packages/core/src/utils/utils.test.ts packages/core/src/customers.acceptance.test.ts packages/core/src/disputes.acceptance.test.ts packages/core/src/checkout.acceptance.test.ts packages/core/src/payment-links.acceptance.test.ts packages/core/src/public-api.test.ts packages/testkit/src/mock/mock-gateway.test.ts\n";
p_v += "If raw-card.test.ts exists, include it. If a test file path 404s, skip that file and note it.\n";
p_v += "4) Grep/read invariants (must hold):\n";
p_v += "   - unpaid getCheckoutSession with amount_received:0 does not publish amount 0 when amount_total is present\n";
p_v += "   - listPaymentMethods paginates or otherwise does not ignore has_more\n";
p_v += "   - raw-card walks metadata / cvc\n";
p_v += "   - PayPal CUSTOMER.DISPUTE.CREATED does not throw in parseWebhookEvent\n";
p_v += "   - README createCheckoutSession uses outcome / idempotencyKey\n";
p_v += "   - customer mutation indeterminate includes a lookup id\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass.\n";

let verify = agent(p_v, #{
    label: "verify:tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Phase 22 r2 blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence.\n";
p_g += "BLOCKERS:\n";
p_g += "P22-CKO-GET-ZERO: unpaid/open getCheckoutSession with expanded PI amount_received 0 publishes amount_total (or omits), never major 0 when amount_total is 1000. Test exists.\n";
p_g += "P22-LIST-TRUNC: listPaymentMethods pages has_more (limit+starting_after or equivalent). Test with two pages or has_more exists.\n";
p_g += "P22-PCI-FENCE: metadata PAN and cvc-only rejected before adapter. Test exists.\n";
p_g += "P22-PP-DISPUTE: parseWebhookEvent(CUSTOMER.DISPUTE.CREATED) returns dual-write dispute.opened (or equivalent) and does not throw. Test exists. Envelope is not paid.\n";
p_g += "P22-README: README checkout sample uses outcome union and idempotencyKey.\n";
p_g += "P22-IND-LOOKUP: createCustomer/createPaymentLink post-submit NetworkError afterProviderSubmit returns indeterminate WITH a lookup id (idempotencyKey or equivalent), not a bare {outcome,message}.\n";
p_g += "Non-blocking allowed: P22-CLONE, P22-ENVELOPE type widening, P22-LOG-PAN, P22-CKO-STATUS remaining processing without charge snapshot, P22-SUB-ID if docs state sub_* vs pi_*.\n";
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
    log("Remediating remaining Phase 22 r2 blockers");
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
        blockers += "Gate missing or failed closed. Re-read P22-CKO-GET-ZERO P22-LIST-TRUNC P22-PCI-FENCE P22-PP-DISPUTE P22-README P22-IND-LOOKUP and fix any still present.\n";
    }

    let p_r = rules;
    p_r += "REMEDIATE remaining Phase 22 r2 blockers. You may edit packages/core (src+docs+CHANGELOG+README) and packages/testkit/src/mock. Do not commit. Do not edit store/routing/reconciliation/observability packages.\n";
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
    p_v2 += "Run bun run --filter @paykernel/core typecheck and bun test packages/core/src/gateways/stripe packages/core/src/gateways/paypal/paypal.gateway.test.ts packages/core/src/gateways/base.gateway.test.ts packages/core/src/customers.acceptance.test.ts packages/core/src/disputes.acceptance.test.ts packages/core/src/checkout.acceptance.test.ts packages/testkit/src/mock/mock-gateway.test.ts.\n";
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
    p_g2 += "Quick re-gate of " + root + " after remediation. READ-ONLY. Read current source.\n";
    p_g2 += "BLOCKERS still required gone: P22-CKO-GET-ZERO P22-LIST-TRUNC P22-PCI-FENCE P22-PP-DISPUTE P22-README P22-IND-LOOKUP.\n";
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
log("Writing Phase 22 r2 gate report to scratch");

let p_rep = "";
p_rep += "Write a short markdown gate report (return it as report_markdown). Repo: " + root + "\n";
p_rep += "Use read_file/grep plus critic/fix/verify/gate outcomes. Be honest. Do not claim PASS without file:line evidence.\n";
p_rep += "Include: verdict, per-ID table covering P22-CKO-GET-ZERO P22-LIST-TRUNC P22-PCI-FENCE P22-PP-DISPUTE P22-IND-LOOKUP P22-OFFSESSION-CUS P22-CKO-CREATE-PI P22-EMPTY-CUS P22-GET-FLAG-2 P22-MOCK P22-README P22-SUB-ID, typecheck/tests, remaining nits.\n";
p_rep += "Do not write docs/audits (that folder was removed). Return {ok, summary, report_markdown}.\n";

let report = agent(p_rep, #{
    label: "report:gate",
    capability_mode: "read-only",
    output_schema: report_schema,
});
log("Report: " + safe_summary(report));

let report_md = "";
if report != () && report.success && report.output != () && report.output.report_markdown != () {
    report_md = report.output.report_markdown;
} else {
    report_md = "# Phase 22 r2 fix-gate\n\n";
    report_md += "gate_pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + "\n";
    report_md += "critic: " + safe_summary(critic) + "\n";
    report_md += "verify: " + safe_summary(verify) + "\n";
    report_md += "gate: " + safe_summary(gate) + "\n";
}
let scratch = write_scratch_file("phase-22-r2-fix-gate.md", report_md);

complete(#{
    summary: "Phase 22 r2 critic/fix/verify/gate finished. Gate pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + ". " + safe_summary(report),
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    report_path: scratch,
    critic: safe_summary(critic),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
});
