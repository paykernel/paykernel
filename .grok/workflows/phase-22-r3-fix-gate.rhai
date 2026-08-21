let meta = #{
    name: "phase-22-r3-fix-gate",
    description: "Critic, fix, verify, and adversarially gate every remaining Phase 22 r3 review finding (PCI false-positives, detach snapshot, dispute invent, empty evidence, list paging, off-session, URLs)",
    phases: [
        #{ title: "Critic", detail: "reconfirm every P22R3 ID against current code" },
        #{ title: "Fix", detail: "four non-overlapping streams for confirmed findings" },
        #{ title: "Verify", detail: "typecheck plus core/testkit tests and invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "scratch gate report" },
    ],
    when_to_use: "After the Phase 22 deep review r3; critic then fix then verify then gate PCI, detach, disputes, lists, off-session, hosted URLs",
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
log("Confirming Phase 22 r3 review findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "r1/r2 IDs already closed (CKO-404, FREEZE-LIST, LINK-AMOUNT, GET-zero, PP-DISPUTE parse, IND-LOOKUP helpers, README outcome) — do not re-open unless they regressed.\n";
p_c += "BLOCKING:\n";
p_c += "P22R3-PCI-FALSE-POS: raw-card.ts isPanLike rejects ANY 13-19 digit leaf after stripping spaces/dashes. createPayment/client.ts calls assertNoRawCardMaterial on ALL createPayment. Millisecond orderId (Date.now()) and metadata.orderId 13-digit timestamps throw InvalidRequestError. Account numbers 16 digits too. Evidence: utils/raw-card.ts PAN_DIGITS; client.ts createPayment.\n";
p_c += "P22R3-PCI-EMBED: whole-leaf only. metadata.note 'card 4242424242424242 expired' ALLOW. Track2 ';4242...=' ALLOW. cvv2/cvc2 CVC keys ALLOW (logger has cvc2/cvv2). Evidence: raw-card.ts CVC_KEYS vs logger.ts SENSITIVE extra aliases; walkRawCardMaterial.\n";
p_c += "P22R3-DETACH-CUS: mapStripePaymentMethod falls back to caller customerId when Stripe customer is null. Detach test expects customerId cus_123 after customer:null. Type says omit when detached. references.status hard-coded active. stripe.gateway.ts mapStripePaymentMethod + detachPaymentMethod; stripe.customers.test.ts P22-EMPTY-CUS vs detach with customerId.\n";
p_c += "P22R3-DSP-INVENT: mapStripeDispute missing status invents needs_response. Webhook stripeDisputeEnvelopeStatus uses processing. stripe.gateway.ts mapStripeDispute native fallback.\n";
p_c += "P22R3-EVIDENCE-EMPTY: submitDisputeEvidence always body.submit=true even if evidence bag empty. No Zod. stripe.gateway.ts submitDisputeEvidence.\n";
p_c += "P22R3-LIST-DSP: listDisputes single GET no limit/has_more/starting_after. Stripe default page 10. Non-array data becomes succeeded []. stripe.gateway.ts listDisputes.\n";
p_c += "P22R3-OFFSESSION-GW: client offSession only checks PM+customer string presence then calls adapter. PayPal/Moyasar/Paymob ignore offSession. Silent hosted-order instead of MIT vault charge. client.ts; paypal.gateway.ts createPayment.\n";
p_c += "P22R3-CANCEL-URL: CreateCheckoutSessionParamsSchema cancelUrl optional. Stripe hosted ui_mode requires cancel_url. validation.ts.\n";
p_c += "P22R3-PLINK-WH: payment_link.* parseWebhookEvent default status pending (not dispute-style processing). stripe.gateway.ts default branch.\n";
p_c += "P22R3-URL-SCHEME: session.url / paymentLink.url only isNonEmptyStripeString; inbound successUrl uses HttpOrHttpsUrlSchema. stripe.gateway.ts create/get checkout and payment links.\n";
p_c += "P22R3-LIST-PM-CAP: listPaymentMethods pages has_more with no max pages. stripe.gateway.ts do/while startingAfter.\n";
p_c += "P22R3-IND-UNKNOWN-CUS: applyIndeterminatePaymentMethodOutcome always sets customerId to unknown string when omitted. customer.types.ts.\n";
p_c += "P22R3-PCI-HOOK-ORDER: executeWithHooks fences AFTER before-hooks. PaymentClient does not fence getCustomer/listPaymentMethods/detachPaymentMethod. base.gateway.ts; client.ts.\n";
p_c += "IMPORTANT (confirm):\n";
p_c += "P22R3-LIST-404: listPaymentMethods/listDisputes 404 throws GatewayApiError; GET maps stripeNotFoundFailed.\n";
p_c += "P22R3-ATTACH-XOR: paymentMethodId wins over token without conflict error.\n";
p_c += "P22R3-CUS-META: mapStripeCustomer does not copy metadata onto Customer.metadata.\n";
p_c += "P22R3-EXPORT-IND: applyIndeterminateCustomer/PaymentMethod/Dispute not exported from index.ts (checkout helper is).\n";
p_c += "P22R3-LAST4: last4 any string, not /^\\d{2,4}$/.\n";
p_c += "P22R3-IDEM-TRUNC: stripeStepIdempotencyKey slices prefix at 255.\n";
p_c += "P22R3-CKO-ACCEPT: checkout.acceptance.test.ts does not assert create is not paid.\n";
p_c += "P22R3-OFFSESSION-DOC: CreatePaymentParams.offSession JSDoc omits customer id requirement.\n";
p_c += "NON-BLOCKING: P22R3-TOKEN-CLAIM (tokenization false vs tok_ attach), P22R3-MKT-SPLIT (MarketplaceSplit vocabulary unused), P22R3-MOCK-GET (mock getCustomer never 404).\n";
p_c += "Return confirmed[] as ID strings, already_fixed[], skipped[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:phase-22-r3",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Four non-overlapping Phase 22 r3 fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style. Do not weaken tests. Prefer fail-closed. Skip IDs the critic marked ALREADY FIXED.\n";
rules += "Never invent major 0. Never treat checkout create success as paid. Never last-write payment_link/dispute envelope onto payment pending/paid incorrectly.\n";
rules += "Keep r2 behavior: getCheckoutSession 404 is failed; unpaid GET amount is amount_total not 0; PayPal CUSTOMER.DISPUTE does not throw; nested identity freeze includes disputes/paymentMethods.\n";

let p_a = rules;
p_a += "STREAM A — PCI FENCE. OWN ONLY:\n";
p_a += "- packages/core/src/utils/raw-card.ts\n";
p_a += "- packages/core/src/utils/raw-card.test.ts\n";
p_a += "Do NOT edit client.ts, stripe.gateway.ts, base.gateway.ts, validation.ts, docs, testkit, index.ts.\n";
p_a += "FIX P22R3-PCI-FALSE-POS + P22R3-PCI-EMBED together. Current whole-leaf 13-19 digit scan is both too aggressive and too weak.\n";
p_a += "Required algorithm:\n";
p_a += "1) Keep gateway-id prefix skip (pm_ tok_ cus_ pi_ cs_ dp_ ch_ sk_ pk_).\n";
p_a += "2) CARD-LIKE KEYS (number, pan, cardnumber, card_number, accountnumber, and existing CVC keys PLUS cvc2, cvv2, cardcvc, card_cvc, card_cvv): reject 13-19 digit PAN-shaped values (spaces/dashes stripped) without Luhn; reject 3-4 digit CVC on CVC keys.\n";
p_a += "3) OTHER KEYS (orderId, metadata.orderId, description, emails, timestamps): do NOT reject a bare 13-19 digit integer unless it is Luhn-valid AND length is 15 or 16 (classic PAN) OR the original string contains spaces/dashes (4242-4242-4242-4242). Millisecond timestamps MUST be allowed. 16-digit Luhn-valid Stripe test PAN 4242424242424242 on metadata.pan MUST still reject (card-like key). 16-digit Luhn PAN as metadata.note embedded in text MUST reject (embedded scan).\n";
p_a += "4) EMBEDDED: scan every string leaf for digit runs 13-19 (optional spaces/dashes) using the same idea as logger containsEmbeddedPan / EMBEDDED_PAN_RUN. Reject if the run is Luhn-valid 15-16 digits, or the leaf is track data (%B or leading semicolon + 13-19 digits).\n";
p_a += "5) Implement a small luhnValid(digits) helper in raw-card.ts. 4242424242424242 is Luhn-valid. Date.now()-style 13-digit timestamps are usually not; still do not reject 13-digit non-Luhn on non-card keys.\n";
p_a += "6) Keep source.type===creditcard and moyasarSource creditcard reject; keep moyasarSource non-creditcard skip (applepay DPAN / token CVC).\n";
p_a += "Tests (raw-card.test.ts): ALLOW orderId millisecond timestamp and metadata.orderId 1724123456789; ALLOW 13-digit non-Luhn account-ish on metadata.orderId; REJECT metadata.pan PAN; REJECT spaced/dashed PAN; REJECT embedded 'card 4242424242424242 expired'; REJECT track2 ;PAN= ; REJECT cvv2/cvc2 123; KEEP existing pm_ allow and source.creditcard reject.\n";

let p_b = rules;
p_b += "STREAM B — STRIPE ADAPTER. OWN ONLY:\n";
p_b += "- packages/core/src/gateways/stripe/stripe.gateway.ts\n";
p_b += "- packages/core/src/gateways/stripe/stripe.gateway.test.ts\n";
p_b += "- packages/core/src/gateways/stripe/stripe.customers.test.ts\n";
p_b += "- packages/core/src/gateways/stripe/stripe.disputes.test.ts\n";
p_b += "- packages/core/src/gateways/stripe/stripe.payment-links.test.ts\n";
p_b += "Do NOT edit raw-card.ts, client.ts, base.gateway.ts, validation.ts, paypal, docs, testkit, customer.types.ts, index.ts.\n";
p_b += "FIX P22R3-DETACH-CUS: detachPaymentMethod must NOT pass caller customerId as fallback into mapStripePaymentMethod. After Stripe customer:null, omit customerId and relatedIds.customerId. Do not stamp references.status active as if still vaulted — use a detached-safe status string such as detached if ProviderReferences allows, else omit customerId and keep status from provider only. CHANGE the test that expects customerId cus_123 after customer:null to expect undefined. Keep P22-EMPTY-CUS omit empty string.\n";
p_b += "FIX P22R3-DSP-INVENT: mapStripeDispute must not invent needs_response. Missing/blank Stripe status -> domain status unknown (same as indeterminate). providerStatus omitted or the raw string if present. Test: GET body without status is not needs_response.\n";
p_b += "FIX P22R3-EVIDENCE-EMPTY: if the built evidence bag has zero keys, throw InvalidRequestError before POST (require at least one common field or stripeEvidence entry). Do not send submit:true with empty evidence. Test: empty evidence {} does not fetch.\n";
p_b += "FIX P22R3-LIST-DSP: page disputes like payment methods (limit=100 + starting_after while has_more). Throw NetworkError if has_more and last id missing. Test two pages. Keep paymentId required.\n";
p_b += "FIX P22R3-LIST-PM-CAP: cap listPaymentMethods pages (e.g. 20 pages = 2000 methods). If still has_more, throw NetworkError (truncated, not silent succeeded). Test or comment+unit for the cap if a 21st page is heavy — at least a named constant and a branch.\n";
p_b += "FIX P22R3-URL-SCHEME: only publish session.url / paymentLink.url when protocol is http: or https: (URL parse). Omit otherwise so isHostedCheckoutRedirect is false. Test javascript: url omitted.\n";
p_b += "FIX P22R3-PLINK-WH: payment_link.* events must not last-write envelope status pending. Use processing (or a dispute-style non-payment-pending) like charge.dispute missing native. Dual-write stays provider.unmapped unless a catalog arm exists — do not invent payment.succeeded. Test parseWebhookEvent payment_link.updated is not pending if that is the old default; at least not treated as a paid payment. Add to stripe.gateway.test.ts.\n";
p_b += "FIX P22R3-LIST-404: listPaymentMethods and listDisputes catch 404 via stripeNotFoundFailed and return outcome failed (parity with getCustomer), never coerce missing customer to []. Test listPaymentMethods 404 is failed.\n";
p_b += "FIX P22R3-ATTACH-XOR: if both paymentMethodId and token are non-empty and resolve to different ids, InvalidRequestError (same posture as customerId vs stripeCustomerId).\n";
p_b += "FIX P22R3-CUS-META: mapStripeCustomer copy string metadata onto Customer.metadata when present (sanitized strings only). Test create/get round-trip metadata.userId.\n";
p_b += "FIX P22R3-LAST4: publish last4 only when /^\\d{2,4}$/. Omit otherwise.\n";
p_b += "FIX P22R3-IDEM-TRUNC: stripeStepIdempotencyKey must not collide two caller keys that differ only in the truncated tail. Prefer hashing the base (hex of a short digest) plus :create/:attach, still <= 255. UUID-length keys stay readable suffix form. Test two 255-char keys that differ at the end produce different step keys.\n";

let p_c2 = rules;
p_c2 += "STREAM C — CLIENT + BASE + TYPES + EXPORTS. OWN ONLY:\n";
p_c2 += "- packages/core/src/client.ts\n";
p_c2 += "- packages/core/src/client.test.ts (only offSession / PCI call-site tests you add)\n";
p_c2 += "- packages/core/src/gateways/base.gateway.ts\n";
p_c2 += "- packages/core/src/gateways/base.gateway.test.ts\n";
p_c2 += "- packages/core/src/types/customer.types.ts\n";
p_c2 += "- packages/core/src/index.ts\n";
p_c2 += "- packages/core/src/public-api.test.ts\n";
p_c2 += "- packages/core/src/public-api.types.test.ts\n";
p_c2 += "- packages/core/src/customers.acceptance.test.ts\n";
p_c2 += "Do NOT edit stripe.gateway.ts, raw-card.ts, validation.ts, paypal, mock-gateway, CHANGELOG, docs.\n";
p_c2 += "FIX P22R3-OFFSESSION-GW: when offSession===true, after resolving the gateway, if the gateway has a capability surface and does not claim paymentMethods, throw OperationNotSupportedError (capability paymentMethods, claimedSupport false) BEFORE createPayment. Stripe still works (claims true). PayPal/Moyasar/Paymob fail closed. Keep existing missing-PM and missing-customer InvalidRequestError. Test in customers.acceptance or client.test: a claiming-payments-only adapter with offSession true does not call createPayment.\n";
p_c2 += "FIX P22R3-PCI-HOOK-ORDER: (1) PaymentClient assertNoRawCardMaterial on getCustomer, listPaymentMethods, detachPaymentMethod (and getCheckoutSession/getDispute/getPaymentLink/deactivatePaymentLink for consistency) before invokeOptionalGated. (2) executeWithHooks: call assertNoRawCardMaterial on paramsForValidation/validatedParams BEFORE runBefore for isPciFencedOperation, and keep the existing post-before fence. Test: before-hook still cannot inject PAN (existing); add a test that detachPaymentMethod with PAN-like paymentMethodId is rejected at client even if a custom non-BaseGateway were used — at minimum client.detachPaymentMethod({paymentMethodId: TEST_PAN}) throws InvalidRequestError before adapter.\n";
p_c2 += "FIX P22R3-IND-UNKNOWN-CUS: applyIndeterminatePaymentMethodOutcome must OMIT customerId when input.customerId is missing/empty — never the string unknown. Snapshot id stays lookupId. Update any BaseGateway test that expected customerId unknown.\n";
p_c2 += "FIX P22R3-EXPORT-IND: export applyIndeterminateCustomerOutcome, applyIndeterminatePaymentMethodOutcome, applyIndeterminateDisputeOutcome, applyIndeterminatePaymentLinkOutcome from index.ts (checkout helper already exported). Add to public-api.test.ts runtime list if that file enumerates functions.\n";
p_c2 += "Acceptance: createPayment with metadata.orderId 13-digit timestamp must NOT throw InvalidRequestError from the PCI fence (depends on Stream A). Add the test in customers.acceptance or a small client test; if Stream A has not landed yet, still write the test (workflow runs streams in parallel — if A is slow, C test may fail verify; that is OK, remediate will sync). Prefer putting the timestamp-orderId PCI allow test in customers.acceptance next to off-session PAN reject.\n";

let p_d = rules;
p_d += "STREAM D — VALIDATION, DOCS, MOCK, CHANGELOG. OWN ONLY:\n";
p_d += "- packages/core/src/types/validation.ts\n";
p_d += "- packages/core/src/types/payment.types.ts\n";
p_d += "- packages/core/src/checkout.acceptance.test.ts\n";
p_d += "- packages/core/src/utils/utils.test.ts (checkout schema tests if cancelUrl lives there)\n";
p_d += "- packages/core/docs/customers.md\n";
p_d += "- packages/core/docs/disputes.md\n";
p_d += "- packages/core/docs/hosted-checkout.md\n";
p_d += "- packages/core/docs/payment-links.md\n";
p_d += "- packages/core/docs/marketplace.md\n";
p_d += "- packages/core/CHANGELOG.md\n";
p_d += "- packages/testkit/src/mock/mock-gateway.ts\n";
p_d += "- packages/testkit/src/mock/mock-gateway.test.ts\n";
p_d += "Do NOT edit stripe.gateway.ts, raw-card.ts, client.ts, base.gateway.ts, index.ts.\n";
p_d += "FIX P22R3-CANCEL-URL: CreateCheckoutSessionParamsSchema require cancelUrl for mode payment and subscription (hosted). Setup mode may omit. Add/adjust utils.test.ts schema cases. hosted-checkout.md: Stripe hosted payment/subscription requires cancelUrl.\n";
p_d += "FIX P22R3-OFFSESSION-DOC: payment.types.ts offSession JSDoc must require stored payment-method id AND customer id. customers.md already says both — keep in sync. Mention offSession is fail-closed unless the gateway claims paymentMethods.\n";
p_d += "FIX P22R3-CKO-ACCEPT: checkout.acceptance.test.ts assert created session is not paid settlement: paymentStatus is not paid (or omitted), no success:true field, status open, isHostedCheckoutRedirect true.\n";
p_d += "FIX P22R3-MKT-SPLIT docs: marketplace.md say Moyasar create uses MoyasarPaymentSplit.recipient_id; generic MarketplaceSplit.destination is vocabulary only and is not mapped.\n";
p_d += "FIX P22R3-MOCK-GET / detach honesty: mock detachPaymentMethod must omit customerId even if params.customerId was passed (detached). getCustomer unknown id: if easy without breaking claim tests, scripted failed remains; do not always invent active for a random id if there is already a history map — only change detach snapshot. Add a mock test that detach with customerId does not publish customerId.\n";
p_d += "Docs PCI: customers.md must say the fence allows numeric order ids / timestamps; rejects Luhn PAN, embedded PAN text, CVC aliases including cvv2. Do not claim every 13-digit leaf is blocked.\n";
p_d += "Docs disputes: missing Stripe status is unknown not needs_response; empty evidence submit is rejected; listDisputes pages.\n";
p_d += "CHANGELOG Unreleased: short bullets for PCI Luhn/timestamp allow, detach omit customerId, dispute unknown status, empty evidence reject, list paging+cap, offSession capability fail-closed, hosted cancelUrl, http(s) checkout/link URLs, payment_link envelope not pending.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:pci-fence", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:stripe-adapter", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_c2, label: "fix:client-base", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:docs-validation", capability_mode: "all", output_schema: fix_schema },
]);

let fi = 0;
for f in fixes {
    log("Fix stream " + fi.to_string() + ": " + safe_summary(f));
    fi += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Typecheck and targeted Phase 22 r3 tests");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root. Paste relevant fail lines in failures[].\n";
p_v += "1) bun run --filter @paykernel/core typecheck\n";
p_v += "2) bun run --filter @paykernel/core typecheck:types\n";
p_v += "3) bun test packages/core/src/utils/raw-card.test.ts packages/core/src/gateways/stripe packages/core/src/gateways/base.gateway.test.ts packages/core/src/customers.acceptance.test.ts packages/core/src/disputes.acceptance.test.ts packages/core/src/checkout.acceptance.test.ts packages/core/src/payment-links.acceptance.test.ts packages/core/src/public-api.test.ts packages/core/src/client.test.ts packages/testkit/src/mock/mock-gateway.test.ts packages/core/src/utils/utils.test.ts\n";
p_v += "If a path 404s, skip and note it.\n";
p_v += "4) Grep/read invariants (must hold):\n";
p_v += "   - timestamp/orderId 13-digit non-Luhn is not rejected by assertNoRawCardMaterial\n";
p_v += "   - embedded PAN text and cvv2 are rejected\n";
p_v += "   - detach with customer:null omits customerId\n";
p_v += "   - mapStripeDispute does not default needs_response\n";
p_v += "   - empty dispute evidence does not POST submit:true\n";
p_v += "   - listDisputes paginates or fail-closes has_more\n";
p_v += "   - offSession on a gateway with paymentMethods false throws OperationNotSupportedError\n";
p_v += "   - hosted payment/subscription schema requires cancelUrl\n";
p_v += "   - checkout/payment-link url publish is http/https only\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass.\n";

let verify = agent(p_v, #{
    label: "verify:tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Phase 22 r3 blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence.\n";
p_g += "BLOCKERS:\n";
p_g += "P22R3-PCI-FALSE-POS: assertNoRawCardMaterial allows millisecond timestamp orderId and metadata.orderId 13-digit non-Luhn. Test exists.\n";
p_g += "P22R3-PCI-EMBED: embedded PAN text and cvv2/cvc2 rejected. Test exists.\n";
p_g += "P22R3-DETACH-CUS: Stripe detach with customer:null omits customerId even if caller passed customerId. Test no longer expects cus_123.\n";
p_g += "P22R3-DSP-INVENT: missing dispute status is not needs_response.\n";
p_g += "P22R3-EVIDENCE-EMPTY: empty evidence throws InvalidRequestError, no fetch.\n";
p_g += "P22R3-LIST-DSP: listDisputes pages has_more (limit+starting_after) or throws on truncated page.\n";
p_g += "P22R3-OFFSESSION-GW: offSession true + paymentMethods false throws OperationNotSupportedError before adapter createPayment.\n";
p_g += "P22R3-CANCEL-URL: payment/subscription checkout schema requires cancelUrl.\n";
p_g += "P22R3-PLINK-WH: payment_link.* envelope is not payment pending last-write (processing or equivalent non-pending).\n";
p_g += "P22R3-URL-SCHEME: javascript: session.url / paymentLink.url omitted.\n";
p_g += "P22R3-LIST-PM-CAP: listPaymentMethods has a finite page cap or equivalent fail-closed.\n";
p_g += "P22R3-IND-UNKNOWN-CUS: indeterminate payment method omits customerId rather than string unknown.\n";
p_g += "P22R3-PCI-HOOK-ORDER: fence before before-hooks AND client fences detach/get/list.\n";
p_g += "Non-blocking allowed if still present: P22R3-TOKEN-CLAIM, P22R3-MKT-SPLIT leftover wording, P22R3-MOCK-GET always-active get, P22R3-IDEM-TRUNC if UUID keys still suffix-form, P22R3-CUS-META if documented write-only.\n";
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
    log("Remediating remaining Phase 22 r3 blockers");
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
        blockers += "Gate missing or failed closed. Re-read P22R3 blockers (PCI, detach, dispute invent, empty evidence, lists, offSession, cancelUrl, URLs, hook order) and fix any still present.\n";
    }

    let p_r = rules;
    p_r += "REMEDIATE remaining Phase 22 r3 blockers. You may edit packages/core (src+docs+CHANGELOG) and packages/testkit/src/mock. Do not commit. Do not edit store/routing/reconciliation/observability packages.\n";
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
    p_v2 += "Run bun run --filter @paykernel/core typecheck and bun test packages/core/src/utils/raw-card.test.ts packages/core/src/gateways/stripe packages/core/src/gateways/base.gateway.test.ts packages/core/src/customers.acceptance.test.ts packages/core/src/disputes.acceptance.test.ts packages/core/src/checkout.acceptance.test.ts packages/testkit/src/mock/mock-gateway.test.ts.\n";
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
    p_g2 += "BLOCKERS still required gone: P22R3-PCI-FALSE-POS P22R3-PCI-EMBED P22R3-DETACH-CUS P22R3-DSP-INVENT P22R3-EVIDENCE-EMPTY P22R3-LIST-DSP P22R3-OFFSESSION-GW P22R3-CANCEL-URL P22R3-PLINK-WH P22R3-URL-SCHEME P22R3-LIST-PM-CAP P22R3-IND-UNKNOWN-CUS P22R3-PCI-HOOK-ORDER.\n";
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
log("Writing Phase 22 r3 gate report to scratch");

let p_rep = "";
p_rep += "Write a short markdown gate report (return it as report_markdown). Repo: " + root + "\n";
p_rep += "Use read_file/grep plus critic/fix/verify/gate outcomes. Be honest. Do not claim PASS without file:line evidence.\n";
p_rep += "Include: verdict, per-ID table covering P22R3-PCI-FALSE-POS P22R3-PCI-EMBED P22R3-DETACH-CUS P22R3-DSP-INVENT P22R3-EVIDENCE-EMPTY P22R3-LIST-DSP P22R3-OFFSESSION-GW P22R3-CANCEL-URL P22R3-PLINK-WH P22R3-URL-SCHEME P22R3-LIST-PM-CAP P22R3-IND-UNKNOWN-CUS P22R3-PCI-HOOK-ORDER P22R3-LIST-404 P22R3-ATTACH-XOR P22R3-CUS-META P22R3-EXPORT-IND P22R3-LAST4, typecheck/tests, remaining nits.\n";
p_rep += "Do not write docs/audits. Return {ok, summary, report_markdown}.\n";

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
    report_md = "# Phase 22 r3 fix-gate\n\n";
    report_md += "gate_pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + "\n";
    report_md += "critic: " + safe_summary(critic) + "\n";
    report_md += "verify: " + safe_summary(verify) + "\n";
    report_md += "gate: " + safe_summary(gate) + "\n";
}
let scratch = write_scratch_file("phase-22-r3-fix-gate.md", report_md);

complete(#{
    summary: "Phase 22 r3 critic/fix/verify/gate finished. Gate pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + ". " + safe_summary(report),
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    report_path: scratch,
    critic: safe_summary(critic),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
});
