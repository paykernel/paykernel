let meta = #{
    name: "paykernel-deep-audit-fix-all",
    description: "Fix all residual deep-audit-2026-08-05 findings (P0/P1 + material P2) in parallel streams, verify, adversarial gate, remediate",
    phases: [
        #{ title: "Recheck", detail: "confirm current audit findings still present" },
        #{ title: "Implement", detail: "parallel non-overlapping fix streams for all residual findings" },
        #{ title: "Integrate", detail: "typecheck/tests + cross-stream consistency" },
        #{ title: "Verify", detail: "typecheck + tests + money-status invariants" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "fix remaining blockers if any" },
        #{ title: "Report", detail: "write fix-result under docs/audits" },
    ],
    when_to_use: "After paykernel-deep-audit SHIP_BLOCKED report; fix everything residual listed",
};

let recheck_schema = #{
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
        "fixed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
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

let fix_schema = #{
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

let audit_doc = root + "/docs/audits/deep-audit-2026-08-05.md";

// ─── Recheck ─────────────────────────────────────────────────────
phase("Recheck");
log("Rechecking residual deep-audit findings in " + root);

let p_re = "";
p_re += "Recheck findings from " + audit_doc + " against current code at " + root + ".\n";
p_re += "READ-ONLY. Use read_file/grep. For each ID: STILL PRESENT or ALREADY FIXED with file:line.\n\n";
p_re += "MUST CHECK BLOCKING / P0+P1 (from deep-audit-2026-08-05):\n";
p_re += "PAYMOB-1 (P0): mapTransactionStatus is_captured without positive captured_amount falls through to paid\n";
p_re += "WEBHOOKS-1 (P0): processWithVerifier treats post-verify parse InvalidWebhookError as forgery/invalid_webhook\n";
p_re += "PAYPAL-1: getPayment bare order COMPLETED -> paid without captures/authorizations\n";
p_re += "PAYMOB-2: resolveRemainingActionAmountCents ignores is_captured/is_refunded when amount fields 0/missing\n";
p_re += "PAYMOB-3: in-memory idempotency FIFO eviction at 1000 drops in-flight/unknown fences\n";
p_re += "MOYASAR-1: paid demoted only when amountMinor undefined; currency-stripped keeps isPaidOutcome\n";
p_re += "MONEY-1: fingerprintParams number/string amounts ignore sibling exponent then drop it\n";
p_re += "CORE-1: Phase-6 coerce upgrades partial-capture requires_action -> succeeded\n";
p_re += "CORE-2: successful void (succeeded+cancelled) coerces to failed\n";
p_re += "RECON-1: shouldForbidReplacementCharge omits manual_review_required\n";
p_re += "RECON-2: mark_consistent(safe:true) for status-only local paid ignores provider.refundedAmount\n";
p_re += "RECON-3: in-flight pending/processing yields manual_review not retry_later\n";
p_re += "STORES-1: recon claim always burns attempts (no webhook-style restore)\n";
p_re += "STORES-2: SQLite/DO listRetryable omit canonicalize of input.now\n";
p_re += "STORES-3: DO recon listDue omits canonicalize of input.now\n";
p_re += "STORES-4: webhook claim miss maps any pending row to not_available with no canonicalize repair\n";
p_re += "WEBHOOKS-2: lease-timeout path skips store.fail + soft-release restores attempts -> maxAttempts no-op\n";
p_re += "WEBHOOKS-5: post-verify InvalidRequestError classified permanent non-retryable\n";
p_re += "PAYPAL-2: CHECKOUT.ORDER.COMPLETED auth-only stays approved vs getPayment authorized\n";
p_re += "MOYASAR-2: voidPayment residual paid keeps natural paid/succeeded; docs claim opposite\n";
p_re += "TESTKIT-1/2/3: mock dual-write / concurrent join / ledger settlement lies\n\n";
p_re += "Also note P2 if quick from audit Medium/Low table.\n";
p_re += "Return confirmed[], already_fixed[], summary.\n";

let recheck = agent(p_re, #{
    label: "recheck:audit-findings",
    capability_mode: "read-only",
    output_schema: recheck_schema,
});
if recheck != () && recheck.success && recheck.output != () {
    log("Recheck: " + recheck.output.summary);
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing residual deep-audit fixes in parallel streams");

let common = "";
common += "Repo root: " + root + "\n";
common += "Audit source of truth: " + audit_doc + " — read YOUR stream section before editing.\n";
common += "Package: PayKernel monorepo (Bun + TypeScript). Do NOT commit. Do NOT push.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; update/add unit tests that currently lock wrong behavior;\n";
common += "re-read changed regions; prefer existing PaymentStatus values (partially_captured, partially_refunded, setup_completed, paid, pending, refunded, refund_pending, refund_failed, refund_completed, etc.);\n";
common += "use isPaidOutcome / domain-status patterns already in codebase; fail-closed on incomplete money snapshots;\n";
common += "ALWAYS publish currency together with major-unit amount fields on GatewayPaymentResult and dual-write entities;\n";
common += "Run bun test on touched test files when possible. Skip items recheck proves already fixed.\n";
common += "OWN FILES ONLY — do not edit other streams' files.\n";
common += "Return JSON {ok, files_changed, summary, notes, fixed_ids}.\n";

// A — Stripe P2 + shared webhook map only if own
let p_a = "";
p_a += common;
p_a += "STREAM A — STRIPE. OWN:\n";
p_a += "- " + root + "/packages/core/src/gateways/stripe/stripe.gateway.ts\n";
p_a += "- " + root + "/packages/core/src/gateways/stripe/**\n";
p_a += "- " + root + "/packages/core/src/gateways/stripe/*.test.ts\n";
p_a += "- " + root + "/packages/core/docs/stripe.md if needed\n";
p_a += "- " + root + "/resources/gateways/stripe/README.md if STRIPE-2\n";
p_a += "FROM AUDIT (mostly P2 for Stripe; no P0 in stripe.gateway itself):\n";
p_a += "STRIPE-1: Checkout priceData.unitAmount skips ISK/UGX whole-unit enforcement — apply same charge-limit/precision as create path.\n";
p_a += "STRIPE-2: resources/gateways/stripe/README.md inverted money-critical semantics — align with packages/core/docs/stripe.md + code.\n";
p_a += "STRIPE-3: mapStripeEventType demotes partial capture but not incomplete-settled processing — fail-closed align with gateway map.\n";
p_a += "If partial-capture forceOutcome/status paths exist that contradict CORE-1 demotions, keep gateway dual-write money-honest (partially_captured / requires_action).\n";
p_a += "Add tests for zero-decimal unitAmount enforcement and incomplete settlement demotion.\n";

// B — PayPal
let p_b = "";
p_b += common;
p_b += "STREAM B — PAYPAL. OWN:\n";
p_b += "- " + root + "/packages/core/src/gateways/paypal/paypal.gateway.ts\n";
p_b += "- " + root + "/packages/core/src/gateways/paypal/**\n";
p_b += "- " + root + "/packages/core/src/gateways/paypal/*.test.ts\n";
p_b += "- " + root + "/packages/core/docs/paypal.md if needed\n";
p_b += "BLOCKING / P1:\n";
p_b += "PAYPAL-1: getPayment bare order COMPLETED must NOT map to paid without successful captures (or refuse paid).\n";
p_b += "  mapPaymentResultStatus / mapStatus: COMPLETED without payments.captures must fail-closed (processing/requires_action/authorized only if auth present).\n";
p_b += "  Evidence: paypal.gateway.ts mapStatus COMPLETED->paid ~2808; mapPaymentResultStatus fallthrough ~3008; getPayment ~385.\n";
p_b += "  Flip tests that lock bare COMPLETED->paid (paypal.gateway.test.ts ~4678).\n";
p_b += "PAYPAL-2: CHECKOUT.ORDER.COMPLETED auth-only must align with getPayment authorized (not stay approved).\n";
p_b += "P2 if quick: PAYPAL-3 missing final_capture treated as final; PAYPAL-4 no hard max-age on transmission-time;\n";
p_b += "PAYPAL-5 AUTHORIZATION.CAPTURED without capture id; PAYPAL-6 missing idempotencyKey ephemeral Request-Id.\n";
p_b += "Add tests: bare COMPLETED no captures not isPaidOutcome; auth-only webhook status authorized.\n";

// C — Paymob
let p_c = "";
p_c += common;
p_c += "STREAM C — PAYMOB. OWN:\n";
p_c += "- " + root + "/packages/core/src/gateways/paymob/paymob.gateway.ts\n";
p_c += "- " + root + "/packages/core/src/gateways/paymob/**\n";
p_c += "- " + root + "/packages/core/src/gateways/paymob/*.test.ts\n";
p_c += "- " + root + "/packages/core/docs/paymob.md if needed\n";
p_c += "BLOCKING FIXES (P0 + P1):\n";
p_c += "PAYMOB-1 (P0): mapTransactionStatus — is_captured without positive captured_amount must NOT fall through to paid.\n";
p_c += "  Align with mapCaptureStatus: require captured_amount > 0 for paid; else processing / not paid.\n";
p_c += "  Evidence: paymob.gateway.ts ~1973-2004 (fail-open at 2003); mapCaptureStatus ~2017-2022.\n";
p_c += "  getPayment uses this path ~1662; dual-write must not invent full amount as settled.\n";
p_c += "PAYMOB-2: resolveRemainingActionAmountCents must honor is_captured/is_refunded terminal flags when amount fields missing/0\n";
p_c += "  (fail-closed refuse remaining or treat as fully moved when flag true without amount).\n";
p_c += "PAYMOB-3: In-memory idempotency Map FIFO eviction must NOT drop in-flight/unknown fences.\n";
p_c += "  Prefer: never evict entries with in-progress promise or unknown outcome; only evict terminal completed;\n";
p_c += "  or refuse new keys when full of non-evictable fences (fail closed) rather than double-apply.\n";
p_c += "P2 if quick: PAYMOB-4 capturePayment ignores pending; PAYMOB-5 remaining TOCTOU.\n";
p_c += "Add tests: is_captured + captured_amount 0/missing -> not paid / not isPaidOutcome; remaining with flags; no double apply after eviction pressure.\n";

// D — Moyasar
let p_d = "";
p_d += common;
p_d += "STREAM D — MOYASAR. OWN:\n";
p_d += "- " + root + "/packages/core/src/gateways/moyasar/moyasar.gateway.ts\n";
p_d += "- " + root + "/packages/core/src/gateways/moyasar/**\n";
p_d += "- " + root + "/packages/core/src/gateways/moyasar/*.test.ts\n";
p_d += "- " + root + "/packages/core/docs/moyasar.md if needed\n";
p_d += "P1 FIXES:\n";
p_d += "MOYASAR-1: Demote paid when currency missing (complete incomplete-money policy) — same as amountMinor undefined.\n";
p_d += "  Evidence: moyasar.gateway.ts ~1311-1349.\n";
p_d += "MOYASAR-2: voidPayment residual paid — docs claim vs code; either money-honest residual paid is intentional and fix docs,\n";
p_d += "  or forceOutcome/status only when voided and no residual paid amount. Prefer money-honest: if residual paid, status paid + isPaidOutcome true;\n";
p_d += "  document clearly; do not lie void succeeded when residual paid without amount honesty.\n";
p_d += "P2 if quick: MOYASAR-3 payment_paid dual-write from envelope without domain paid-like check.\n";
p_d += "Add tests: currency-stripped paid demoted; void residual docs/code aligned.\n";

// E — Webhooks package
let p_e = "";
p_e += common;
p_e += "STREAM E — WEBHOOKS engine + docs. OWN:\n";
p_e += "- " + root + "/packages/webhooks/src/**\n";
p_e += "- " + root + "/packages/webhooks/docs/**\n";
p_e += "- " + root + "/packages/webhooks/README.md\n";
p_e += "Also may touch (shared client verify composition — coordinate carefully):\n";
p_e += "- " + root + "/packages/core/src/client.ts ONLY for handleWebhook parse vs verify error class split if needed for WEBHOOKS-1/5\n";
p_e += "- " + root + "/packages/core/docs/webhooks.md for parse-vs-forgery honesty\n";
p_e += "BLOCKING FIXES:\n";
p_e += "WEBHOOKS-1 (P0): Split verify forgery from post-verify parse/config errors.\n";
p_e += "  isForgeryClassVerifyError must NOT treat all InvalidWebhookError as forgery if thrown from parse stage.\n";
p_e += "  Prefer: client.handleWebhook throws distinct error for parse (e.g. InvalidRequestError or new ParseWebhookError / keep InvalidWebhookError only for verify-false);\n";
p_e += "  engine maps parse failures to retryable/server (5xx) not invalid_webhook/400.\n";
p_e += "  Evidence: packages/webhooks/src/engine.ts ~211-218, ~1007-1009; packages/core/src/client.ts ~696-733; docs webhooks.md ~149-152.\n";
p_e += "WEBHOOKS-5: Post-verify InvalidRequestError must NOT be permanent non-retryable for paid redelivery — treat as retryable/server unless clearly client-config permanent.\n";
p_e += "WEBHOOKS-2: Lease-timeout path must make maxAttempts effective — call store.fail or do not soft-restore attempts forever;\n";
p_e += "  Evidence: memory-store.ts ~92-117; engine.ts ~519-539,666-667; algorithm.ts ~249-252.\n";
p_e += "P2 if quick: WEBHOOKS-3 idle payloadHash supersede burns attempts; WEBHOOKS-4 docs payload_conflict honesty.\n";
p_e += "Add tests: parse failure after successful verify -> retryable not invalid_webhook; lease-timeout eventually hits maxAttempts.\n";

// F — Stores
let p_f = "";
p_f += common;
p_f += "STREAM F — STORES (timestamp canonicalize + claim freezes + recon attempts). OWN:\n";
p_f += "- " + root + "/packages/store-sqlite/src/**\n";
p_f += "- " + root + "/packages/store-durable-objects/src/**\n";
p_f += "- " + root + "/packages/store-postgres/src/**\n";
p_f += "- " + root + "/packages/store-d1/src/**\n";
p_f += "- " + root + "/packages/store-turso/src/**\n";
p_f += "- " + root + "/packages/store-redis/src/** if STORES-5\n";
p_f += "- " + root + "/packages/sql-foundation/src/** for STORES-1 attempt restore if shared claim SQL\n";
p_f += "- " + root + "/packages/reconciliation/src/scheduler.ts ONLY if STORES-1 fix lives there (prefer foundation)\n";
p_f += "FIXES:\n";
p_f += "STORES-2: SQLite + DO listRetryable MUST canonicalize input.now (match postgres/d1/turso canonicalizeIsoTimestamp).\n";
p_f += "STORES-3: DO recon listDue MUST canonicalize input.now.\n";
p_f += "STORES-4: Webhook claim miss: do not freeze forever on non-canonical available_at — canonicalize/repair or treat as retryable due.\n";
p_f += "  Pattern in store-postgres webhook-inbox-store claim miss ~108-114 — fix across adapters consistently.\n";
p_f += "STORES-1: Reconciliation claim attempt accounting — soft-release restore attempts on deploy thrash like webhooks, or document + budget;\n";
p_f += "  prefer soft-restore on lease expiry without successful process when infra error (align algorithm with webhooks).\n";
p_f += "P2 if quick: STORES-5 Redis EXPIRE retention; STORES-6 migrate lock honesty.\n";
p_f += "Add tests for non-Z now canonicalize on listRetryable/listDue.\n";

// G — Core + Money
let p_g = "";
p_g += common;
p_g += "STREAM G — CORE orchestration + MONEY. OWN:\n";
p_g += "- " + root + "/packages/core/src/types/operation-result.ts\n";
p_g += "- " + root + "/packages/core/src/types/payment-event.ts if needed\n";
p_g += "- " + root + "/packages/core/src/types/webhook-event-map.ts if needed\n";
p_g += "- " + root + "/packages/core/src/utils/idempotency.ts\n";
p_g += "- " + root + "/packages/core/src/utils/money.ts\n";
p_g += "- " + root + "/packages/core/src/utils/currency.ts\n";
p_g += "- " + root + "/packages/core/src/utils/logger.ts\n";
p_g += "- " + root + "/packages/core/src/utils/retry.ts if MONEY-5\n";
p_g += "- " + root + "/packages/core/src/utils/*.test.ts\n";
p_g += "- " + root + "/packages/core/src/types/*.test.ts if any\n";
p_g += "- " + root + "/packages/core/src/types/validation.ts if CORE-3\n";
p_g += "- " + root + "/packages/core/docs/operation-results.md if needed\n";
p_g += "- " + root + "/packages/core/docs/money.md if needed\n";
p_g += "Do NOT edit client.ts if STREAM E owns parse/verify split — only if E skipped client.\n";
p_g += "FIXES:\n";
p_g += "CORE-1: Phase-6 map/infer must preserve partial-capture requires_action (do not upgrade to succeeded).\n";
p_g += "  Evidence: operation-result.ts ~356-401,294-298; gateways demote at paymob ~2070, stripe ~2492.\n";
p_g += "CORE-2: Successful void (outcome succeeded + status cancelled) must not coerce to failed.\n";
p_g += "  Evidence: operation-result.ts ~378-384,294-298,424-459.\n";
p_g += "MONEY-1: fingerprintParams must preserve sibling exponent for number/string amount bags — no scale collision.\n";
p_g += "  Evidence: idempotency.ts ~219-226,294-297,381-399.\n";
p_g += "P2 if quick: CORE-3 checkout image schemes; CORE-4 refundedAt freeze; MONEY-2 TTL; MONEY-3 redact; MONEY-4 clone; MONEY-5 retry delay sanitize.\n";
p_g += "Add unit tests for requires_action preservation, void not failed, fingerprint exponent.\n";

// H — Reconciliation + routing
let p_h = "";
p_h += common;
p_h += "STREAM H — RECONCILIATION + ROUTING. OWN:\n";
p_h += "- " + root + "/packages/reconciliation/src/**\n";
p_h += "- " + root + "/packages/reconciliation/docs/**\n";
p_h += "- " + root + "/packages/routing/src/**\n";
p_h += "- " + root + "/packages/routing/docs/** if needed\n";
p_h += "BLOCKING FIXES:\n";
p_h += "RECON-1: shouldForbidReplacementCharge must include manual_review_required (forbid re-charge while review).\n";
p_h += "  Evidence: packages/reconciliation/src/policy.ts ~459-471,502-531.\n";
p_h += "RECON-2: mark_consistent(safe:true) status-only local paid must NOT ignore provider.refundedAmount — surface refund drift / unsafe.\n";
p_h += "  Evidence: policy.ts ~224-227,344-348; compare.ts ~84-100.\n";
p_h += "RECON-3: In-flight pending/processing consistent path should yield retry_later not manual_review when still settling.\n";
p_h += "  Evidence: policy.ts ~79-92,331-343.\n";
p_h += "P2 if quick: RECON-4 maxInFlight key parse; ROUTE-1 amount range without currency; ROUTE-2 requiredCapabilities on fallback;\n";
p_h += "ROUTE-3 expert_override forged prefix.\n";
p_h += "Add tests for forbid replacement on manual_review; refundedAmount not mark_consistent safe; in-flight retry_later.\n";

// I — Testkit + observability
let p_i = "";
p_i += common;
p_i += "STREAM I — TESTKIT + OBSERVABILITY. OWN:\n";
p_i += "- " + root + "/packages/testkit/src/**\n";
p_i += "- " + root + "/packages/observability/src/**\n";
p_i += "- " + root + "/packages/observability/docs/** if OBS docs\n";
p_i += "FIXES:\n";
p_i += "TESTKIT-1/2/3: Fix mock gateway money dual-write / concurrent join / ledger settlement lies.\n";
p_i += "  capture override must keep dual-write in sync; concurrent join must not train false symmetry;\n";
p_i += "  ledger must settle on isPaidOutcome / paid status not bare outcome===succeeded.\n";
p_i += "  Evidence: packages/testkit/src/mock/mock-gateway.ts ~691-720,1120-1141,1267-1362,357-358.\n";
p_i += "P2: TESTKIT-4 ensurePaymentLedger clamp scripted captured/refunded.\n";
p_i += "OBS-1/2: docs honesty for redaction re-export and authorized restore if still wrong.\n";
p_i += "Update package tests.\n";

// J — Docs audit bookkeeping
let p_j = "";
p_j += common;
p_j += "STREAM J — DOCS audit bookkeeping. OWN:\n";
p_j += "- " + root + "/docs/audits/** only\n";
p_j += "Write " + root + "/docs/audits/deep-audit-fix-pass-2026-08-05.md summarizing stream ownership and checklist of residual IDs being fixed from deep-audit-2026-08-05.md.\n";
p_j += "List P0: PAYMOB-1, WEBHOOKS-1.\n";
p_j += "List P1 blocking: PAYPAL-1, PAYMOB-2, PAYMOB-3, MOYASAR-1, MONEY-1, WEBHOOKS-5, STORES-2/3/4, RECON-1/2.\n";
p_j += "List P1 other: CORE-1/2, RECON-3, STORES-1, WEBHOOKS-2, PAYPAL-2, MOYASAR-2, TESTKIT-1/2/3.\n";
p_j += "List material P2 streams: Stripe, PayPal final_capture/keys, money redact/TTL, routing, stores 5-6, OBS.\n";
p_j += "Do NOT edit packages/**.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:stripe", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:paypal", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:paymob", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:moyasar", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_e, label: "fix:webhooks", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_f, label: "fix:stores", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_g, label: "fix:core-money", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_h, label: "fix:recon-routing", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_i, label: "fix:testkit-obs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_j, label: "fix:docs-audit", capability_mode: "all", output_schema: implement_schema },
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
            log("OK implement: " + r.output.summary);
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
p_int += "Integrate deep-audit-fix-all streams in " + root + ". Do NOT commit.\n";
p_int += "1) git status / diff — fix any broken TS from parallel streams.\n";
p_int += "2) bun run typecheck across monorepo — fix all errors from our changes.\n";
p_int += "3) bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso until green (note: known sql-foundation bun:sqlite multi-connection WAL flake may remain — isolate if needed).\n";
p_int += "4) Ensure PaymentStatus still includes partially_captured, partially_refunded, refund_pending, refund_failed, refund_completed, setup_completed.\n";
p_int += "5) Cross-check invariants from deep-audit-2026-08-05:\n";
p_int += "   - PAYMOB-1: is_captured without positive captured_amount is NOT paid / not isPaidOutcome\n";
p_int += "   - WEBHOOKS-1: post-verify parse failures are NOT invalid_webhook forgery class\n";
p_int += "   - PAYPAL-1: bare COMPLETED without captures not paid\n";
p_int += "   - PAYMOB-2/3, MOYASAR-1, MONEY-1 fingerprint exponent, CORE-1/2 coerce, RECON-1/2, STORES-2/3/4 canonicalize\n";
p_int += "6) Update " + root + "/docs/audits/deep-audit-fix-pass-2026-08-05.md with what landed vs remaining.\n";
p_int += "7) Prefer fail-closed money status; flip any remaining tests locking old lies for blocking IDs.\n";
p_int += "Return {ok, files_changed, summary, notes, fixed_ids}.\n";

let int_result = agent(p_int, #{
    label: "integrate:typecheck-test",
    capability_mode: "all",
    output_schema: implement_schema,
});
if int_result == () || !int_result.success || (int_result.output != () && int_result.output.ok != true) {
    log("Integrate reported issues — verify will surface details");
} else if int_result.output != () {
    log("Integrate OK: " + int_result.output.summary);
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify residual deep-audit fixes in " + root + " with command evidence and file reads.\n";
p_ver += "1) cd " + root + " && bun run typecheck\n";
p_ver += "2) cd " + root + " && bun test packages/core packages/webhooks packages/reconciliation packages/routing packages/testkit packages/observability packages/store-contracts packages/sql-foundation packages/store-d1 packages/store-durable-objects packages/store-redis packages/store-postgres packages/store-sqlite packages/store-turso\n";
p_ver += "3) Invariant greps/reads (must hold for residual P0/P1):\n";
p_ver += "   - PAYMOB-1: is_captured without positive captured_amount does not map to paid\n";
p_ver += "   - WEBHOOKS-1: post-verify parse failures not forgery/invalid_webhook permanent 400\n";
p_ver += "   - PAYPAL-1: bare COMPLETED without captures not paid\n";
p_ver += "   - PAYMOB-2 remaining flags; PAYMOB-3 no evict in-flight fences\n";
p_ver += "   - MOYASAR-1 currency demote; MONEY-1 fingerprint exponent preserved\n";
p_ver += "   - CORE-1 requires_action preserved; CORE-2 void not failed\n";
p_ver += "   - RECON-1/2 forbid replacement / refund surface; STORES-2/3/4 canonicalize now\n";
p_ver += "   - WEBHOOKS-2 maxAttempts lease path; WEBHOOKS-5 InvalidRequestError not permanent paid-loss\n";
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
    typecheck_ok = ver.output.typecheck_ok;
    tests_ok = ver.output.tests_ok;
    invariants_ok = ver.output.invariants_ok;
    if ver.output.failures != () {
        ver_failures = ver.output.failures;
    }
    log("Verify: " + ver.output.summary);
} else {
    log("Verify agent failed");
    ver_failures.push("verify agent failed or empty");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarially gate PayKernel deep-audit-fix-all residual remediation in " + root + ".\n";
p_gate += "Skeptical: read actual code with read_file/grep. Do NOT trust implement summaries.\n";
p_gate += "BLOCKING if still broken (from deep-audit-2026-08-05):\n";
p_gate += "PAYMOB-1: is_captured without positive captured_amount still maps to paid\n";
p_gate += "WEBHOOKS-1: post-verify parse still classified invalid_webhook forgery\n";
p_gate += "PAYPAL-1: bare COMPLETED still paid without captures\n";
p_gate += "PAYMOB-2: remaining still ignores terminal flags\n";
p_gate += "PAYMOB-3: FIFO still drops in-flight fences under load\n";
p_gate += "MOYASAR-1: currency-stripped still paid\n";
p_gate += "MONEY-1: fingerprint still drops exponent on number/string bags\n";
p_gate += "RECON-1: replacement still allowed on manual_review_required\n";
p_gate += "RECON-2: mark_consistent still ignores refundedAmount\n";
p_gate += "STORES-2/3/4: still missing now canonicalize / claim freeze\n";
p_gate += "WEBHOOKS-5: post-verify InvalidRequestError still permanent paid-signal loss\n";
p_gate += "P0: typecheck or tests red (ignore known sql-foundation WAL flake if isolated)\n";
p_gate += "Non-blocking residual pure P2/P3 allowed if documented.\n";
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
    gate_pass = gate.output.pass == true;
    if gate.output.blocking != () { blocking = gate.output.blocking; }
    if gate.output.non_blocking != () { non_blocking = gate.output.non_blocking; }
    gate_summary = gate.output.summary;
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
    p_fix += "Fix remaining BLOCKING residual deep-audit issues in " + root + ".\n";
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
    p_fix += "Priority: PAYMOB-1 (P0), WEBHOOKS-1 (P0), PAYPAL-1, PAYMOB-2/3, MOYASAR-1, MONEY-1, WEBHOOKS-5,\n";
    p_fix += "STORES-2/3/4, RECON-1/2, CORE-1/2, WEBHOOKS-2, then typecheck/tests green.\n";
    p_fix += "Read " + audit_doc + " for evidence paths. Fix surgically, re-run typecheck && tests until green. Do not commit.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_fix, #{
        label: "remediate:blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    let p_ver2 = "";
    p_ver2 += "Re-verify " + root + " after remediation. Run bun run typecheck && bun test (core+webhooks+recon+routing+testkit+observability+stores).\n";
    p_ver2 += "Re-check residual blocking invariants from deep-audit-2026-08-05 (PAYMOB-1, WEBHOOKS-1, PAYPAL-1, PAYMOB-2/3, MOYASAR-1, MONEY-1, RECON-1/2, STORES-2/3/4, WEBHOOKS-5).\n";
    p_ver2 += "Return typecheck_ok, tests_ok, invariants_ok, failures, commands_run, summary, ok.\n";
    let ver2 = agent(p_ver2, #{
        label: "verify:post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if ver2 != () && ver2.success && ver2.output != () {
        typecheck_ok = ver2.output.typecheck_ok;
        tests_ok = ver2.output.tests_ok;
        invariants_ok = ver2.output.invariants_ok;
        if ver2.output.failures != () { ver_failures = ver2.output.failures; }
        log("Post-remediate verify: " + ver2.output.summary);
    }

    let p_gate2 = "";
    p_gate2 += "Quick re-gate of " + root + " after remediation. Read code for remaining residual blocking IDs only from deep-audit-2026-08-05.\n";
    p_gate2 += "Return pass, blocking, non_blocking, summary.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        if gate2.output.blocking != () { blocking = gate2.output.blocking; } else { blocking = []; }
        if gate2.output.non_blocking != () { non_blocking = gate2.output.non_blocking; }
        gate_summary = gate2.output.summary;
    }
    if rem != () && rem.success && rem.output != () {
        log("Remediate: " + rem.output.summary);
    }
} else {
    log("No remediation needed");
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
let final_pass = gate_pass == true && typecheck_ok == true && tests_ok == true && invariants_ok == true;

let p_rep = "";
p_rep += "Write fix result report to " + root + "/docs/audits/deep-audit-fix-result-2026-08-05.md\n";
p_rep += "Include: final_pass, typecheck_ok, tests_ok, invariants_ok, gate_pass, implement ok/fail counts,\n";
p_rep += "blocking list, non_blocking residual, summary of what was fixed vs remaining, pointer to original audit " + audit_doc + ".\n";
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
p_rep += "Verify with greps that residual P0/P1 code paths improved. Do not invent fixes not in tree.\n";
p_rep += "Return {ok, report_path, summary}.\n";

let report_agent = agent(p_rep, #{
    label: "report:write-result",
    capability_mode: "read-write",
    output_schema: report_schema,
});
if report_agent != () && report_agent.success && report_agent.output != () {
    log("Report: " + report_agent.output.report_path + " — " + report_agent.output.summary);
}

log("paykernel-deep-audit-fix-all complete final_pass=" + final_pass.to_string());

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
