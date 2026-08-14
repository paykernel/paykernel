let meta = #{
    name: "phase-0-5-fix-gate",
    description: "Critic, fix, verify, and adversarially gate Phase 0-5 review findings",
    phases: [
        #{ title: "Critic", detail: "confirm each finding still present" },
        #{ title: "Fix", detail: "five non-overlapping implementation streams" },
        #{ title: "Verify", detail: "typecheck plus targeted tests" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "write gate report" },
    ],
    when_to_use: "After a Phase 0-5 review; fix money, capabilities, testkit, and baseline drift then gate",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
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
log("Confirming Phase 0-5 findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep. Do not edit.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "P05-MONEY-1: Zod MoneyAmountBaseSchema strips Money.exponent (validation.ts).\n";
p_c += "P05-CAPS-1: client.gateway() bypasses assertCapability; BaseGateway.assertCapability unused.\n";
p_c += "P05-CAPS-2: plugin adapters without supports/capabilities are fail-open.\n";
p_c += "P05-PAYPAL-1: supports(partialCapture) true but default order capture rejects amount.\n";
p_c += "P05-REL-1: release.yml triggers on master; git default is main.\n";
p_c += "P05-API-1: public-api.test.ts does not freeze Object.keys; isKnownCurrencyCode missing.\n";
p_c += "P05-TK-1: FakeClock applyLatency ignores abort after advance.\n";
p_c += "P05-TK-2: mock refundPayment ignores provider_ok_client_timeout and settles money.\n";
p_c += "P05-TK-3: webhookHelpers unbound; uses DEFAULT secret not instance secret.\n";
p_c += "P05-CONF-1: amount_conversion optional amount; logging_redaction self-tests core logger.\n";
p_c += "P05-VER-1: BUILTIN_ADAPTER_VERSION 0.8.0 vs package 0.1.0-next.0.\n";
p_c += "Return confirmed[], already_fixed[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:phase-0-5",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Five non-overlapping fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";

let p_a = rules;
p_a += "STREAM A MONEY. Files ONLY:\n";
p_a += "packages/core/src/types/validation.ts\n";
p_a += "packages/core/src/utils/money.ts\n";
p_a += "packages/core/src/utils/money.test.ts\n";
p_a += "packages/core/src/utils/money.edge.test.ts\n";
p_a += "packages/core/src/utils/currency.ts\n";
p_a += "packages/core/src/utils/currency.test.ts\n";
p_a += "packages/core/src/gateways/moyasar/moyasar.gateway.test.ts\n";
p_a += "packages/core/docs/money.md\n";
p_a += "FIX P05-MONEY-1: add optional exponent (integer 0-18) to MoneyAmountBaseSchema so Zod does not strip it.\n";
p_a += "isMoney: if exponent present, require integer 0-18 else false.\n";
p_a += "getCurrencyExponent: reject override > 18 like money().\n";
p_a += "Test: parse CreatePaymentParams / Money through Zod keeps exponent; Moyasar createPayment money(20.12,OMR,{exponentOverrides:{OMR:2}}) converts to 2012 not 20120.\n";
p_a += "Add isKnownCurrencyCode tests. Do not edit stripe.gateway.ts.\n";

let p_b = rules;
p_b += "STREAM B CAPABILITIES. Files ONLY:\n";
p_b += "packages/core/src/client.ts\n";
p_b += "packages/core/src/gateways/base.gateway.ts\n";
p_b += "packages/core/src/gateways/gateway-registry.ts\n";
p_b += "packages/core/src/gateways/stripe/stripe.gateway.ts\n";
p_b += "packages/core/src/gateways/stripe/stripe.gateway.test.ts\n";
p_b += "packages/core/src/client.test.ts\n";
p_b += "packages/core/src/plugin-architecture.test.ts\n";
p_b += "packages/core/src/create-payment-client.test.ts\n";
p_b += "FIX P05-CAPS-1: after before-hooks in executeWithHooks, assert capabilities using this.supports (payments, refunds, voids, hostedCheckout, partials when amount set, authorization when capture===false, marketplaceSplits when splits present).\n";
p_b += "FIX P05-CAPS-2: createAll attaches DEFAULT_GATEWAY_CAPABILITIES + supports() when instance lacks a surface (fail-closed). Update createNamedAdapter tests to claim payments:true if they create payments.\n";
p_b += "FIX Stripe unknown currency: stripeCurrencyExponent must not default unknown codes to 2; throw InvalidRequestError (JYP). Keep ISK/UGX/MGA/zero/three-decimal tables.\n";
p_b += "Add tests: gateway().voidPayment with voids:false throws; capture:false without authorization throws; JYP throws.\n";

let p_c = rules;
p_c += "STREAM C CLAIMS/DOCS. Files ONLY:\n";
p_c += "packages/core/src/gateways/builtin-capabilities.ts\n";
p_c += "packages/core/src/gateways/gateway-capabilities.ts\n";
p_c += "packages/core/src/gateways/capabilities-docs.ts\n";
p_c += "packages/core/src/gateways/capability-claims.test.ts\n";
p_c += "packages/core/src/gateways/gateway-capabilities.test.ts\n";
p_c += "packages/core/docs/gateway-capabilities.md\n";
p_c += "packages/core/docs/custom-gateways.md\n";
p_c += "FIX P05-PAYPAL-1: KEEP partialCapture true (auth path works). Document that PayPal order captures reject amount; callers must use paypalCaptureType authorization.\n";
p_c += "FIX P05-VER-1: BUILTIN_ADAPTER_VERSION must match packages/core/package.json version (read it).\n";
p_c += "Clarify CAPABILITY_OPERATION_MAP.authorization comment: map is method presence only, not create-path proof.\n";
p_c += "Regenerate gateway-capabilities.md via bun run docs:capabilities or the generator.\n";

let p_d = rules;
p_d += "STREAM D TESTKIT. Files ONLY under packages/testkit/src/\n";
p_d += "FIX P05-TK-1: FakeClock applyLatency must re-check abort after advance (yield microtask) and throw NetworkError if aborted.\n";
p_d += "FIX P05-TK-2: refundPayment must handle provider_ok_client_timeout / provider_success_client_timeout like create (ledger then NetworkError). Add test.\n";
p_d += "FIX P05-TK-3: bind webhookHelpers.signWebhook and generateWebhookEvent to instance webhookSecret and name.\n";
p_d += "FIX P05-CONF-1: amount_conversion must require result.amount === expectedMajor. logging_redaction must inject logger and assert sink has no PAN/apiSecret. network_failure must not accept success:true. indeterminate_outcomes must also script outcome indeterminate.\n";
p_d += "Do not weaken tests. Run bun test packages/testkit after edits.\n";

let p_e = rules;
p_e += "STREAM E BASELINE/CI. Files ONLY:\n";
p_e += ".github/workflows/release.yml\n";
p_e += ".github/workflows/ci.yml\n";
p_e += "docs/releases.md\n";
p_e += ".changeset/README.md\n";
p_e += "packages/core/src/public-api.test.ts\n";
p_e += "packages/core/src/public-api.types.test.ts\n";
p_e += "packages/core/docs/behavioral-contracts.md\n";
p_e += "packages/core/docs/baseline/public-api.md\n";
p_e += "packages/core/docs/baseline/package-contents.md\n";
p_e += "packages/core/docs/baseline/entry-points.md\n";
p_e += "FIX P05-REL-1: release.yml on.push.branches must be main. Align docs/releases.md and .changeset/README.md (not master).\n";
p_e += "FIX P05-API-1: public-api.test.ts must assert sorted Object.keys(sdk) equals the freeze list; include isKnownCurrencyCode.\n";
p_e += "CI test step: run bun run test (or the same package list as root package.json test script). Do not enable prettier on packages/core/src.\n";
p_e += "behavioral-contracts.md: version 0.1.0-next.0; store contracts live in @paykernel/store-contracts not testkit.\n";
p_e += "If you can, bun run baseline after build to refresh baseline md. Do not invent export tables.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:money", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:caps", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_c, label: "fix:claims", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:testkit", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_e, label: "fix:baseline", capability_mode: "all", output_schema: fix_schema },
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
p_v += "Run: bun run --filter @paykernel/core typecheck\n";
p_v += "Run: bun test packages/core/src/utils/money.test.ts packages/core/src/utils/money.edge.test.ts packages/core/src/utils/currency.test.ts packages/core/src/client.test.ts packages/core/src/plugin-architecture.test.ts packages/core/src/public-api.test.ts packages/core/src/gateways/capability-claims.test.ts packages/core/src/gateways/moyasar/moyasar.gateway.test.ts packages/core/src/gateways/stripe/stripe.gateway.test.ts packages/testkit\n";
p_v += "If typecheck:types exists, run bun run typecheck:types.\n";
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

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. pass=true only if ALL blockers are gone with evidence.\n";
p_g += "Blockers: P05-MONEY-1 Zod keeps exponent; P05-CAPS-1 executeWithHooks or gateway methods assert claims; P05-CAPS-2 missing surface fail-closed; P05-REL-1 release on main; P05-TK-1/2/3 mock abort/refund/helpers; P05-API-1 Object.keys freeze includes isKnownCurrencyCode.\n";
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
    p_r += "Re-run the failing bun tests after edits. Return {ok, fixed, remaining, summary}.\n";
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
p_rep += "Write " + root + "/packages/core/docs/baseline/phase-0-5-fix-gate-report.md\n";
p_rep += "Summarize critic, five fix streams, verify commands, gate verdict, remaining nits.\n";
p_rep += "Be factual. Cite file paths. Return {ok, report_path, summary}.\n";
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
    summary: "Phase 0-5 critic/fix/verify/gate finished",
    gate_pass: gate_pass,
    report_path: report_path,
    critic: safe_summary(critic),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
});
