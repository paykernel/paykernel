let meta = #{
    name: "fix-phase-3-5-audit",
    description: "Fix all Phase 3–5 audit non-blocking findings: mock failed ledger, checkout Money, freeze hygiene, barrel, docs",
    phases: [
        #{ title: "Implement", detail: "parallel fix streams for audit findings" },
        #{ title: "Integrate", detail: "unify, re-read, keep green" },
        #{ title: "Verify", detail: "typecheck + tests + repro + greps" },
        #{ title: "Gate", detail: "adversarial re-check of each fixed item" },
        #{ title: "Remediate", detail: "fix any remaining blocking items" },
    ],
    when_to_use: "After phase-3-5-audit-report.md findings; apply all confirmed non-blocking fixes",
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "mock_failed_ledger_ok", "checkout_money_ok", "freeze_hygiene_ok", "doc_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "mock_failed_ledger_ok": #{ "type": "boolean" },
        "checkout_money_ok": #{ "type": "boolean" },
        "freeze_hygiene_ok": #{ "type": "boolean" },
        "doc_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "checklist", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
        "report_path": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/payments-sdk"
} else {
    args.root
};

// ─── Implement (parallel streams) ────────────────────────────────
phase("Implement");
log("Fixing Phase 3–5 audit findings in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Source of findings: packages/core/docs/baseline/phase-3-5-audit-report.md\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Keep 0.x backward compat. Tests are source of truth. No float money conversion.\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: mock failed ledger (highest priority)
let p_a = "";
p_a += common;
p_a += "STREAM A — FIX mock gateway scripted `failed` leaves ledger as `paid`.\n";
p_a += "OWN: packages/testkit/src/mock/mock-gateway.ts + mock-gateway.test.ts\n\n";
p_a += "BUG: createPayment fallback() always writeLedger(paid|authorized) BEFORE outcome remap.\n";
p_a += "For outcome 'failed', result is success:false status:failed but getPaymentState still shows paid.\n";
p_a += "Repro was confirmed. Same class of bug may affect other non-success remapped outcomes that call fallback().\n\n";
p_a += "REQUIRED FIX (prefer this design):\n";
p_a += "1) fallback() for createPayment MUST NOT write paid/authorized ledger.\n";
p_a += "   It only builds the GatewayPaymentResult shape (defaultPaymentResult + rawResponse).\n";
p_a += "2) After resolvePaymentOutcome returns without throw:\n";
p_a += "   - If result.success OR status === 'processing' (or indeterminate processing): ensurePaymentLedger as today.\n";
p_a += "   - Else if result is a non-success terminal (e.g. status 'failed'): write an honest ledger entry with\n";
p_a += "     status = result.status (failed), capturedAmountMinor = 0, refundedAmountMinor = 0, authorized = false.\n";
p_a += "   - Do NOT leave a prior paid ledger hanging.\n";
p_a += "3) Dual-timeout provider_ok_client_timeout path MUST still write provider-side paid ledger via the\n";
p_a += "   existing ledgerOnProviderSuccess callback (keep that behavior).\n";
p_a += "4) Plain timeout/network_error must still throw WITHOUT writing paid ledger.\n";
p_a += "5) Default/no-script success path: fallback no longer writes; ensurePaymentLedger after success must write.\n\n";
p_a += "TESTS (add to mock-gateway.test.ts):\n";
p_a += "- createPayment with { outcome: 'failed' }: result.success===false, result.status==='failed',\n";
p_a += "  getPaymentState(id).status is 'failed' (or not 'paid'), capturedAmount is 0 (not full amount).\n";
p_a += "- createPayment default/succeeded: ledger paid still works.\n";
p_a += "- timeout still does not leave paid ledger (existing coverage — keep green).\n";
p_a += "- provider_ok_client_timeout still has provider-side success via getLastProviderSideSuccess.\n\n";
p_a += "Run: bun test packages/testkit\n";
p_a += "Do not change production core gateways.\n";

// Stream B: Stripe checkout Money dual-accept
let p_b = "";
p_b += common;
p_b += "STREAM B — Stripe checkout amount fields accept AmountInput (number | Money).\n";
p_b += "OWN: packages/core/src/types/validation.ts, payment.types.ts if needed,\n";
p_b += "public-api.types.test.ts, stripe tests, docs/money.md, docs/stripe.md briefly.\n\n";
p_b += "CURRENT: PositiveAmountInputSchema dual-accepts number|Money for create/capture/refund.\n";
p_b += "CreateCheckoutSessionParamsSchema.amount is z.number() only.\n";
p_b += "StripeCheckoutLineItemSchema.priceData.amount is z.number() only.\n";
p_b += "Runtime toStripeAmount already accepts AmountInput.\n\n";
p_b += "FIX:\n";
p_b += "1) CreateCheckoutSessionParamsSchema.amount: use PositiveAmountInputSchema.optional() (or union that\n";
p_b += "   accepts positive number | Money). Preserve refineMoneyCurrencyMatch if currency present.\n";
p_b += "2) priceData.amount: accept number | Money (MoneyAmountSchema or nonnegative dual-accept).\n";
p_b += "   Note line items allow zero amount for free trials — use nonnegative dual-accept, not Positive-only.\n";
p_b += "   Keep superRefine: exactly one of amount or unitAmount.\n";
p_b += "3) Types CreateCheckoutSessionParams should surface amount as AmountInput where applicable.\n";
p_b += "4) Update money.md to include checkout/session amounts in dual-accept scope.\n";
p_b += "5) Tests: Money on createCheckoutSession amount and/or lineItems priceData.amount passes validation\n";
p_b += "   and stripe gateway path (mock fetch) if covered; type tests accept Money.\n";
p_b += "6) exactOptionalPropertyTypes ON — careful with optional amount fields.\n";
p_b += "Run relevant tests: bun test packages/core (or targeted validation/stripe tests).\n";

// Stream C: freeze hygiene + stepDelayMs + testkit exports
let p_c = "";
p_c += common;
p_c += "STREAM C — Testkit public surface hygiene + core freeze duplicates.\n";
p_c += "OWN:\n";
p_c += "- packages/testkit/src/index.ts (stepDelayMs export decision)\n";
p_c += "- packages/testkit/src/public-api.test.ts\n";
p_c += "- packages/core/src/public-api.test.ts (dedupe abort helper freeze entries)\n\n";
p_c += "FIXES:\n";
p_c += "1) stepDelayMs: REMOVE from packages/testkit/src/index.ts public re-exports.\n";
p_c += "   Keep the function exported from outcomes.ts for internal mock-gateway import.\n";
p_c += "   Do NOT remove the function itself — only the package-root re-export.\n";
p_c += "2) Align testkit public-api.test.ts freeze list with remaining root runtime exports:\n";
p_c += "   ADD if still exported: generateWebhookEvent, signWebhook, DEFAULT_MOCK_WEBHOOK_SECRET,\n";
p_c += "   generateDuplicateWebhooks, generateOutOfOrderWebhooks.\n";
p_c += "   Do NOT freeze stepDelayMs after removal.\n";
p_c += "3) packages/core/src/public-api.test.ts: remove DUPLICATE abort helper entries\n";
p_c += "   (combineAbortSignals, createTimeoutSignal, isAbortError, mapHttpAbortError,\n";
p_c += "   extractAbortSignal, stripAbortSignal, withAbortSignal appear twice ~lines 94-100 and 118-124).\n";
p_c += "   Keep a single occurrence of each. Unique freeze should match public exports.\n";
p_c += "4) Run public-api tests for both packages.\n";

// Stream D: gateways barrel + doc drift + audit report update
let p_d = "";
p_d += common;
p_d += "STREAM D — Unused gateways barrel + doc drift fixes.\n";
p_d += "OWN:\n";
p_d += "- packages/core/src/gateways/index.ts usage decision\n";
p_d += "- packages/core/docs/baseline/phase-5-gate-report.md\n";
p_d += "- packages/core/docs/baseline/phase-3-5-audit-report.md (mark items fixed after)\n\n";
p_d += "1) gateways/index.ts barrel:\n";
p_d += "   Preferred fix: rewire packages/core/src/index.ts gateway re-exports to go through\n";
p_d += "   `export { ... } from \"./gateways\"` (or `from \"./gateways/index\"`) for symbols the barrel already\n";
p_d += "   exports, so the barrel is the single internal surface — NOT dead code.\n";
p_d += "   Only symbols already on the barrel can be consolidated; keep direct imports for modules not\n";
p_d += "   re-exported by the barrel (e.g. factories, registry, concrete gateways if missing from barrel).\n";
p_d += "   ALTERNATIVE if barrel is incomplete: expand gateways/index.ts to export all gateway public symbols\n";
p_d += "   that root index currently exports, then re-export from root via barrel. Do not drop public API.\n";
p_d += "   Update stale path comment `// file: packages/payments/...` to packages/core if you touch the file.\n";
p_d += "2) phase-5-gate-report.md: replace reference to non-existent money-gateway-integration.test.ts with\n";
p_d += "   the real suite names: money.edge.test.ts, money.provider-profiles.test.ts, and per-gateway tests.\n";
p_d += "3) After other streams land, update phase-3-5-audit-report.md Confirmed non-blocking section to note\n";
p_d += "   FIXED with date for each remediated item (or add a Remediation section). Do not delete history.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:mock-failed-ledger", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:checkout-money", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:freeze-hygiene", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:barrel-docs", capability_mode: "all", output_schema: implement_schema },
];

let results = parallel(jobs);
let ok_n = 0;
let fail_n = 0;
let i = 0;
while i < results.len() {
    let r = results[i];
    if r != () && r.success && r.output != () && r.output.ok == true {
        ok_n += 1;
        log("OK: " + r.output.summary);
    } else {
        fail_n += 1;
        log("FAIL stream slot " + i.to_string());
    }
    i += 1;
}
log("Implement streams ok=" + ok_n.to_string() + " fail=" + fail_n.to_string());

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
let p_int = "";
p_int += "Integrate Phase 3–5 audit fixes in " + root + ".\n";
p_int += "Do NOT commit.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) mockGateway createPayment({outcome:'failed'}) → getPaymentState not paid with full capture.\n";
p_int += "2) Checkout schema accepts Money for session amount and line priceData.amount (nonnegative path).\n";
p_int += "3) stepDelayMs NOT on testkit package root; still works inside mock via outcomes import.\n";
p_int += "4) testkit public-api freezes webhook helpers that remain exported.\n";
p_int += "5) core public-api freeze has no duplicate abort helper entries.\n";
p_int += "6) gateways barrel is used by root index OR clearly not dead (wired).\n";
p_int += "7) phase-5-gate-report no longer cites phantom money-gateway-integration.test.ts.\n";
p_int += "8) phase-3-5-audit-report notes remediation for fixed items.\n";
p_int += "9) All tests green:\n";
p_int += "   bun run typecheck && bun run typecheck:types\n";
p_int += "   bun test packages/core packages/testkit\n";
p_int += "   bun run check:boundaries\n";
p_int += "10) No regressions: timeout still not paid; dual-timeout still provider-ok; success ledger still paid.\n";
p_int += "11) exactOptionalPropertyTypes respected.\n";
p_int += "Fix any cross-stream breakage. Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:audit-fixes",
    capability_mode: "all",
    output_schema: implement_schema,
});
if int_result == () || !int_result.success || int_result.output.ok != true {
    log("Integrate reported issues — verify will surface");
} else {
    log("Integrate OK: " + int_result.output.summary);
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify Phase 3–5 audit fixes in " + root + " with hard evidence.\n";
p_ver += "You MAY fix trivial breakages. Do NOT commit.\n\n";
p_ver += "1) bun run typecheck\n";
p_ver += "2) bun run typecheck:types\n";
p_ver += "3) bun test packages/core packages/testkit\n";
p_ver += "4) bun run check:boundaries\n";
p_ver += "5) Ad-hoc repro mock failed ledger:\n";
p_ver += "   Use bun to import mockGateway from packages/testkit, createPayment with outcome failed,\n";
p_ver += "   assert getPaymentState status is NOT paid (expect failed or zero capture).\n";
p_ver += "6) Evidence checkout Money accepted (test or ad-hoc Zod parse).\n";
p_ver += "7) Evidence stepDelayMs not on testkit root export (import * as tk; 'stepDelayMs' in tk === false or undefined).\n";
p_ver += "8) Evidence public-api freezes include webhook helpers; core has no duplicate abort keys in freeze array.\n";
p_ver += "9) Evidence phase-5-gate-report no longer mentions money-gateway-integration.test.ts\n";
p_ver += "10) Evidence gateways/index is imported by root index OR still justified.\n\n";
p_ver += "Set mock_failed_ledger_ok, checkout_money_ok, freeze_hygiene_ok, doc_ok from evidence.\n";
p_ver += "ok=true only if typecheck, tests, and all feature flags true.\n";
p_ver += "Return verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:audit-fixes",
    capability_mode: "all",
    output_schema: verify_schema,
});

let verify_ok = false;
let verify_summary = "verify failed";
let verify_failures = "";
if ver != () && ver.success && ver.output != () {
    verify_ok = ver.output.ok == true;
    verify_summary = ver.output.summary;
    if ver.output.failures != () {
        verify_failures = json_encode(ver.output.failures);
    }
    log("Verify ok=" + verify_ok.to_string() + " — " + verify_summary);
    write_scratch_file("fix-3-5-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 3–5 audit fixes at " + root + ".\n";
p_gate += "Fail closed. Independent re-check each finding. Do not trust implementer claims.\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures: " + verify_failures + "\n";
p_gate += "Verify ok: " + verify_ok.to_string() + "\n\n";
p_gate += "CHECKLIST (each PASS or BLOCKING):\n";
p_gate += "F1) mock failed outcome: result failed AND ledger not paid/full-capture (repro yourself)\n";
p_gate += "F2) timeout/network still not false-paid; dual-timeout provider side still works\n";
p_gate += "F3) checkout accepts Money for amount / priceData.amount without breaking number path\n";
p_gate += "F4) stepDelayMs not public root export; mock still works\n";
p_gate += "F5) testkit freeze includes remaining webhook root exports\n";
p_gate += "F6) core public-api freeze no duplicate abort entries\n";
p_gate += "F7) gateways barrel wired or justified\n";
p_gate += "F8) phase-5 gate report phantom test name fixed\n";
p_gate += "F9) typecheck + bun test core+testkit green\n\n";
p_gate += "Update packages/core/docs/baseline/phase-3-5-audit-report.md with a Remediation section if needed.\n";
p_gate += "pass=true only if F1–F9 all evidenced and verify_ok true (or you independently prove green).\n";
p_gate += "Return gate_schema.\n";

let gate = agent(p_gate, #{
    label: "gate:audit-fixes",
    capability_mode: "all",
    output_schema: gate_schema,
});

let gate_pass = false;
let blocking_json = "[]";
let gate_summary = "gate failed";
if gate != () && gate.success && gate.output != () {
    gate_pass = gate.output.pass == true;
    gate_summary = gate.output.summary;
    if gate.output.blocking != () {
        blocking_json = json_encode(gate.output.blocking);
    }
    log("Gate pass=" + gate_pass.to_string() + " — " + gate_summary);
    write_scratch_file("fix-3-5-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    let p_fix = "";
    p_fix += "Gate FAILED for audit fixes at " + root + ".\n";
    p_fix += "Blocking: " + blocking_json + "\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Verify: " + verify_summary + " failures: " + verify_failures + "\n";
    p_fix += "Fix ALL blocking. Do NOT commit.\n";
    p_fix += "Re-run typecheck, tests, mock failed ledger repro, boundaries.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";
    let fix = agent(p_fix, #{
        label: "remediate:audit-fixes",
        capability_mode: "all",
        output_schema: fix_schema,
    });
    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let re = agent(
        "Re-verify audit fixes at " + root + ". Run typecheck, typecheck:types, bun test core+testkit, boundaries, mock failed ledger repro. Return verify_schema.",
        #{ label: "verify:post-remediate", capability_mode: "all", output_schema: verify_schema },
    );
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
    }

    let gate2 = agent(
        "Final adversarial gate after remediation at " + root + ". Fail closed on F1-F9. Update audit report. Return gate_schema.",
        #{ label: "gate:final-audit-fixes", capability_mode: "all", output_schema: gate_schema },
    );
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        gate_summary = gate2.output.summary;
        if gate2.output.blocking != () {
            blocking_json = json_encode(gate2.output.blocking);
        }
        log("Final gate pass=" + gate_pass.to_string());
    }
}

complete(#{
    workflow: "fix-phase-3-5-audit",
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: "Audit fix workflow done. gate_pass=" + gate_pass.to_string() + " verify_ok=" + verify_ok.to_string() + " — " + gate_summary,
});
