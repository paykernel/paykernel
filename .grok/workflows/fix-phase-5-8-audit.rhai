let meta = #{
    name: "fix-phase-5-8-audit",
    description: "Fix Phase 5–8 audit findings: refund outcome dual-write, freeze, nextAction identity, docs, CI testkit",
    phases: [
        #{ title: "Implement", detail: "parallel streams for refund dual-write, freeze/identity, docs+CI" },
        #{ title: "Integrate", detail: "wire exports, re-read, keep green" },
        #{ title: "Verify", detail: "typecheck + full tests + greps" },
        #{ title: "Gate", detail: "adversarial re-check of each fixed item" },
        #{ title: "Remediate", detail: "fix any remaining blocking items" },
    ],
    when_to_use: "After phase-5-8-audit-report.md findings; apply confirmed non-blocking fixes",
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "refund_dual_write_ok", "docs_ci_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "typecheck_types_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "refund_dual_write_ok": #{ "type": "boolean" },
        "identity_ok": #{ "type": "boolean" },
        "docs_ci_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "portability_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "test_summary": #{ "type": "string" },
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

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Fixing Phase 5–8 audit findings in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Source of findings: packages/core/docs/baseline/phase-5-8-audit-report.md\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Keep 0.x backward compat. Tests are source of truth. No float money conversion.\n";
common += "exactOptionalPropertyTypes ON — careful with optional fields.\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: refund outcome dual-write (highest priority)
let p_a = "";
p_a += common;
p_a += "STREAM A — Refund outcome dual-write parity with payments (Phase 6 polish).\n";
p_a += "OWN:\n";
p_a += "- packages/core/src/types/operation-result.ts (+ tests)\n";
p_a += "- packages/core/src/gateways/{stripe,moyasar,paypal,paymob}/*.gateway.ts refundPayment returns\n";
p_a += "- packages/core/src/index.ts exports\n";
p_a += "- packages/testkit mock refund paths if needed to use same helper\n";
p_a += "- packages/core/docs/operation-results.md brief note on refund dual-write\n\n";
p_a += "CONTEXT:\n";
p_a += "Payments use applyOutcomeToGatewayResult for outcome+success dual-write.\n";
p_a += "Refunds on all 4 built-ins return only success/status/ids without outcome.\n";
p_a += "Helpers already exist: successFromRefundOutcome, inferRefundOperationOutcome, mapGatewayRefundToOperationResult.\n";
p_a += "RefundOperationOutcome = succeeded | failed | pending | indeterminate.\n\n";
p_a += "REQUIRED:\n";
p_a += "1) Add applyOutcomeToGatewayRefundResult(base, outcome, extras?) that:\n";
p_a += "   - sets outcome, success via successFromRefundOutcome(outcome)\n";
p_a += "   - for indeterminate: reconciliationRequired: true (always)\n";
p_a += "   - preserves gatewayRefundId, status, totalRefunded, refundedAt, rawResponse, providerRequestId if present\n";
p_a += "   - does NOT invent false succeeded from failed status\n";
p_a += "2) Export from index.ts + public-api freeze if value freeze list needs the new function.\n";
p_a += "3) Wire all 4 gateways refundPayment success paths:\n";
p_a += "   Stripe success return → outcome succeeded (status completed mapping)\n";
p_a += "   Moyasar reflectsRefund completed → succeeded; pending → pending\n";
p_a += "   PayPal: status completed → succeeded; pending → pending; failed → failed with success false\n";
p_a += "   Paymob: completed/pending/failed accordingly from existing status logic\n";
p_a += "   Prefer: build base fields then applyOutcomeToGatewayRefundResult(base, inferredOutcome)\n";
p_a += "   OR set outcome explicitly matching status then apply helper for success dual-write.\n";
p_a += "4) Unit/acceptance tests: each gateway refund mock returns outcome; mapGatewayRefund uses dual-written outcome;\n";
p_a += "   successFromRefundOutcome consistency; indeterminate path if any gateway has it.\n";
p_a += "5) Testkit: use applyOutcomeToGatewayRefundResult if refunds dual-write manually — keep parity.\n";
p_a += "6) Docs: operation-results.md note that built-in refunds dual-write outcome in 0.x after this fix.\n";
p_a += "Run: bun test packages/core packages/testkit focused on refund/operation-result.\n";

// Stream B: after-hook nextAction freeze + type freeze expansion
let p_b = "";
p_b += common;
p_b += "STREAM B — After-hook identity freeze nextAction + public type freeze hygiene.\n";
p_b += "OWN:\n";
p_b += "- packages/core/src/gateways/base.gateway.ts MONEY_IDENTITY_KEYS\n";
p_b += "- packages/core/src/client.test.ts or base/hook tests if needed\n";
p_b += "- packages/core/src/public-api.types.test.ts (expand Phase 5-8 type coverage)\n";
p_b += "- packages/core/src/public-api.test.ts if new runtime export from stream A needs freeze\n\n";
p_b += "FIXES:\n";
p_b += "1) Add 'nextAction' to MONEY_IDENTITY_KEYS so after-hooks cannot forge/strip nextAction\n";
p_b += "   the way they cannot forge outcome/status. Keep rawResponse additive (do NOT freeze rawResponse).\n";
p_b += "2) Add a test: after-hook on create/requires_action cannot replace nextAction with a forged redirect\n";
p_b += "   (or cannot invent nextAction when gateway omitted it).\n";
p_b += "3) Expand public-api.types.test.ts to cover more exported Phase 5–8 types that index exports,\n";
p_b += "   at least: MoneyFailureKind (if exported), GatewayRuntimeDeps, PaymentRuntime, Clock, CryptoProvider,\n";
p_b += "   ApplyOutcomeGatewayBase, RawWebhookPayloadCodec (if exported), PersistedPaymentEventEnvelope,\n";
p_b += "   ProviderEventMetadata, STABLE type, RefundOperationOutcome, applyOutcomeToGatewayRefundResult types.\n";
p_b += "   Prefer expectType / assignability checks over exhaustive freeze of every option bag —\n";
p_b += "   focus on symbols that appear in packages/core/src/index.ts type exports.\n";
p_b += "4) Do not break existing type tests.\n";

// Stream C: docs fulfillment + behavioral-contracts + CI testkit
let p_c = "";
p_c += common;
p_c += "STREAM C — Docs fulfillment guidance + CI includes testkit.\n";
p_c += "OWN:\n";
p_c += "- packages/core/docs/paypal.md\n";
p_c += "- packages/core/docs/behavioral-contracts.md (paid|approved)\n";
p_c += "- packages/core/docs/stripe.md / moyasar.md if they show if(result.success) for fulfillment (grep first)\n";
p_c += "- .github/workflows/ci.yml\n";
p_c += "- packages/core/docs/baseline/phase-5-8-audit-report.md remediation notes only after fixes land\n\n";
p_c += "FIXES:\n";
p_c += "1) paypal.md:\n";
p_c += "   - For create/capture/auth paths that check success for 'API failed', keep success/status checks for\n";
p_c += "     terminal failures, BUT add comments that fulfillment uses isPaidOutcome for paid settlement.\n";
p_c += "   - void example if (result.success) → prefer status/outcome checks; note success is API-ok.\n";
p_c += "   - refund section already warns about success — reinforce outcome dual-write if stream A lands.\n";
p_c += "2) behavioral-contracts.md critical rule: say paid OR approved (paid-like), point to isPaidOutcome.\n";
p_c += "3) Grep packages/core/docs for 'if (result.success)' fulfillment examples and fix misleading ones.\n";
p_c += "4) CI Test step: change `bun test packages/core` to `bun test packages/core packages/testkit`\n";
p_c += "   (match monorepo test intent for core+testkit; webhooks optional if slow — prefer include testkit at minimum).\n";
p_c += "   Also consider: bun test packages/core packages/testkit packages/webhooks for full monorepo parity.\n";
p_c += "   Prefer full monorepo suite if it stays reliable offline.\n";
p_c += "5) Do not change intentional 0.x design docs (Money-only at 1.0 still deferred).\n";

// Stream D: encryptRawWebhookPayload + optional redact note
let p_d = "";
p_d += common;
p_d += "STREAM D — encryptRawWebhookPayload string path safety + audit report remediation section.\n";
p_d += "OWN:\n";
p_d += "- packages/core/src/types/payment-event.ts (encryptRawWebhookPayload)\n";
p_d += "- packages/core/docs/webhook-events.md if needed\n";
p_d += "- packages/core/docs/baseline/phase-5-8-audit-report.md (Remediation section after other streams)\n\n";
p_d += "FIX:\n";
p_d += "1) For encryptRawWebhookPayload: when plaintext is a string, try JSON.parse → if object, redact via\n";
p_d += "   existing redactWebhookPayloadSecrets then stringify; if parse fails, pass through as today\n";
p_d += "   (binary-ish / non-JSON strings stay app-owned). Document behavior in JSDoc + webhook-events.md.\n";
p_d += "   Uint8Array/Buffer remain app-owned (do not invent binary redaction).\n";
p_d += "2) Add unit test: JSON string containing secret key is redacted before encrypt codec receives it.\n";
p_d += "3) After streams A–C land, append ## Remediation (2026-08-03) to phase-5-8-audit-report.md listing\n";
p_d += "   FIXED items with file paths. Do not erase original findings history.\n";
p_d += "SKIP intentionally: 0.x major number results, Math.random crypto last-resort, Buffer.isBuffer detect,\n";
p_d += "bun build --target node, full Deno/workerd matrix, gateway-local money wrapper DRY.\n";

let jobs = [
    #{ prompt: p_a, label: "fix:refund-dual-write", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_b, label: "fix:identity-freeze-types", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "fix:docs-ci", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_d, label: "fix:encrypt-report", capability_mode: "all", output_schema: implement_schema },
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
log("Integrating streams and resolving conflicts");

let p_int = "";
p_int += "Repo: " + root + "\n";
p_int += "Integrate Phase 5–8 audit fixes after parallel streams. Do NOT commit.\n";
p_int += "1) Ensure applyOutcomeToGatewayRefundResult is exported from packages/core/src/index.ts and frozen in public-api.test.ts.\n";
p_int += "2) Ensure all 4 gateways import and use it on refundPayment returns.\n";
p_int += "3) Re-read operation-result.ts for type errors (exactOptionalPropertyTypes).\n";
p_int += "4) Ensure MONEY_IDENTITY_KEYS includes nextAction; tests green.\n";
p_int += "5) Ensure CI yml tests core+testkit (+webhooks if intended).\n";
p_int += "6) Run bun run typecheck && bun run typecheck:types && bun test packages/core packages/testkit\n";
p_int += "   Fix any failures from merge conflicts between streams.\n";
p_int += "7) If encryptRawWebhookPayload change broke tests, fix tests to match new JSON-string redaction.\n";
p_int += "Return implement_schema {ok, files_changed, summary}.\n";

let integ = agent(p_int, #{
    label: "fix:integrate-5-8",
    capability_mode: "all",
    output_schema: implement_schema,
});
if integ != () && integ.success && integ.output != () {
    log("Integrate: " + integ.output.summary);
} else {
    log("Integrate agent failed");
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Verifying fixes");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "VERIFY Phase 5–8 audit fixes. Run commands, do not commit.\n\n";
p_v += "1) bun run typecheck\n";
p_v += "2) bun run typecheck:types\n";
p_v += "3) bun test packages/core packages/testkit\n";
p_v += "4) bun run check:boundaries\n";
p_v += "5) bun run check:runtime-portability\n\n";
p_v += "Greps for refund_dual_write_ok:\n";
p_v += "A) applyOutcomeToGatewayRefundResult exists and is exported\n";
p_v += "B) all 4 gateways refundPayment set outcome (rg outcome near refund returns)\n";
p_v += "C) MONEY_IDENTITY_KEYS includes nextAction\n";
p_v += "D) CI runs bun test with packages/testkit\n";
p_v += "E) paypal.md does not teach bare if(result.success) as paid fulfillment without caveat\n";
p_v += "F) behavioral-contracts mentions approved or paid-like / isPaidOutcome\n\n";
p_v += "Set ok=true only if typecheck + tests pass and refund dual-write greps look good.\n";
p_v += "Return verify_schema.\n";

let ver = agent(p_v, #{
    label: "verify:phase5-8-fixes",
    capability_mode: "execute",
    output_schema: verify_schema,
});

let verify_ok = false;
let verify_summary = "verify failed";
if ver != () && ver.success && ver.output != () {
    verify_ok = ver.output.ok == true;
    verify_summary = ver.output.summary;
    log("Verify ok=" + verify_ok.to_string() + " — " + verify_summary);
    write_scratch_file("fix-5-8-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of fixed items");

let p_g = "";
p_g += "Repo: " + root + "\n";
p_g += "Adversarial gate: re-check each Phase 5–8 fix was done correctly. READ-ONLY except you may write\n";
p_g += "packages/core/docs/baseline/phase-5-8-audit-report.md Remediation section if missing.\n";
p_g += "Do NOT commit.\n\n";
p_g += "Checklist (mark each with PASS/FAIL evidence):\n";
p_g += "1) applyOutcomeToGatewayRefundResult exists + exported\n";
p_g += "2) stripe/moyasar/paypal/paymob refundPayment dual-write outcome\n";
p_g += "3) nextAction in MONEY_IDENTITY_KEYS + test that hooks cannot forge nextAction\n";
p_g += "4) public-api types expanded for Phase 5-8 symbols\n";
p_g += "5) CI includes testkit\n";
p_g += "6) paypal.md / behavioral-contracts fulfillment guidance fixed\n";
p_g += "7) encryptRawWebhookPayload JSON string redaction when parseable\n";
p_g += "8) typecheck + tests still green (re-run if needed)\n";
p_g += "9) Intentional non-fixes remain intentional (0.x number majors, Math.random last-resort, Buffer detect, full runtime matrix)\n\n";
p_g += "pass=true only if no blocking remain and critical dual-write + tests green.\n";
p_g += "Return gate_schema. report_path if you update audit report.\n";

let gate = agent(p_g, #{
    label: "gate:phase5-8-fixes",
    capability_mode: "all",
    output_schema: gate_schema,
});

let pass = false;
let blocking = [];
let non_blocking = [];
let gate_summary = "gate failed";
let report_path = "";

if gate != () && gate.success && gate.output != () {
    pass = gate.output.pass == true && verify_ok;
    if gate.output.blocking != () {
        blocking = gate.output.blocking;
    }
    if gate.output.non_blocking != () {
        non_blocking = gate.output.non_blocking;
    }
    gate_summary = gate.output.summary;
    if gate.output.report_path != () {
        report_path = gate.output.report_path;
    }
    log("Gate pass=" + pass.to_string() + " — " + gate_summary);
    write_scratch_file("fix-5-8-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed");
    pass = false;
    blocking.push("Gate agent failed");
}

// ─── Remediate if needed ─────────────────────────────────────────
phase("Remediate");

if !pass || blocking.len() > 0 || !verify_ok {
    log("Remediating remaining issues");
    let p_r = "";
    p_r += "Repo: " + root + "\n";
    p_r += "Fix remaining Phase 5–8 remediation blockers. Do NOT commit.\n";
    p_r += "Verify summary: " + verify_summary + "\n";
    p_r += "Gate summary: " + gate_summary + "\n";
    p_r += "Blocking: " + json_encode(blocking) + "\n";
    p_r += "Non-blocking: " + json_encode(non_blocking) + "\n\n";
    p_r += "Fix blocking items only; re-run typecheck + bun test packages/core packages/testkit.\n";
    p_r += "Return fix_schema.\n";

    let rem = agent(p_r, #{
        label: "remediate:phase5-8",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if rem != () && rem.success && rem.output != () {
        log("Remediate: " + rem.output.summary);
        // Re-verify quickly
        let p_rv = "";
        p_rv += "Repo: " + root + "\n";
        p_rv += "Quick re-verify after remediate: bun run typecheck && bun run typecheck:types && bun test packages/core packages/testkit\n";
        p_rv += "Confirm applyOutcomeToGatewayRefundResult on all 4 gateways. Return verify_schema.\n";
        let rv = agent(p_rv, #{
            label: "reverify:phase5-8",
            capability_mode: "execute",
            output_schema: verify_schema,
        });
        if rv != () && rv.success && rv.output != () {
            verify_ok = rv.output.ok == true;
            verify_summary = rv.output.summary;
            pass = verify_ok && rem.output.ok == true && (rem.output.remaining == () || rem.output.remaining.len() == 0);
            if rem.output.remaining != () && rem.output.remaining.len() > 0 {
                blocking = rem.output.remaining;
                pass = false;
            } else if verify_ok {
                blocking = [];
            }
        } else {
            pass = false;
        }
    } else {
        pass = false;
        blocking.push("Remediate agent failed");
    }
} else {
    log("No remediation needed");
}

complete(#{
    phases: "5-8-fix",
    pass: pass,
    verify_ok: verify_ok,
    blocking_count: blocking.len(),
    non_blocking_count: non_blocking.len(),
    blocking: blocking,
    non_blocking: non_blocking,
    report_path: report_path,
    verify_summary: verify_summary,
    gate_summary: gate_summary,
    summary: if pass {
        "Phase 5–8 audit fixes PASS: " + verify_summary
    } else {
        "Phase 5–8 audit fixes FAIL: " + gate_summary + " | " + verify_summary
    },
});
