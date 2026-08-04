let meta = #{
    name: "audit-phases-5-8",
    description: "Deep audit of roadmap Phases 5–8: money, typed outcomes, webhook events, runtime portability — roadmap compliance, logic bugs, dead code, tests",
    phases: [
        #{ title: "Live-Checks", detail: "typecheck, tests, boundaries, portability, greps for anti-patterns" },
        #{ title: "Phase-Audit", detail: "parallel deep audits for Phase 5, 6, 7, 8 vs roadmap" },
        #{ title: "Cross-Cut", detail: "dead code, consistency, export surface, doc/code drift, regression across 5-8" },
        #{ title: "Verify-Findings", detail: "adversarial skeptics re-check each blocking candidate" },
        #{ title: "Report", detail: "synthesize fail-closed audit report" },
    ],
    when_to_use: "Deep review/audit of shipped Phase 5–8 work against roadmap.md without re-implementing",
};

let live_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "boundaries_ok", "portability_ok", "test_summary", "grep_hits", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "typecheck_types_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "portability_ok": #{ "type": "boolean" },
        "test_summary": #{ "type": "string" },
        "grep_hits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let phase_audit_schema = #{
    "type": "object",
    "required": [
        "phase", "roadmap_tasks", "acceptance", "blocking", "non_blocking",
        "logic_bugs", "dead_code", "missing_tests", "honest_gaps", "summary"
    ],
    "properties": #{
        "phase": #{ "type": "integer" },
        "roadmap_tasks": #{
            "type": "array",
            "maxItems": 20,
            "items": #{
                "type": "object",
                "required": ["id", "status", "evidence"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "status": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "gap": #{ "type": "string" },
                },
            },
        },
        "acceptance": #{
            "type": "array",
            "maxItems": 10,
            "items": #{
                "type": "object",
                "required": ["id", "status", "evidence"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "status": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                    "gap": #{ "type": "string" },
                },
            },
        },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "logic_bugs": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "dead_code": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "missing_tests": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "honest_gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let cross_schema = #{
    "type": "object",
    "required": ["blocking", "non_blocking", "dead_code", "inconsistencies", "export_issues", "summary"],
    "properties": #{
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "dead_code": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "inconsistencies": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "export_issues": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "doc_drift": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "regression_risks": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "severity", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "severity": #{ "type": "string" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
        "file": #{ "type": "string" },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "dismissed", "phase5", "phase6", "phase7", "phase8", "report_path", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "dismissed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "phase5": #{ "type": "string" },
        "phase6": #{ "type": "string" },
        "phase7": #{ "type": "string" },
        "phase8": #{ "type": "string" },
        "report_path": #{ "type": "string" },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/paykernel"
} else {
    args.root
};

// ─── Live checks ─────────────────────────────────────────────────
phase("Live-Checks");
log("Running live checks in " + root);

let p_live = "";
p_live += "You are the live-check agent for a Phase 5–8 audit of the monorepo at " + root + ".\n";
p_live += "You MAY run shell commands. Prefer not to edit files; only fix if a command is blocked by a trivial local issue.\n";
p_live += "Do NOT commit. Do NOT push.\n\n";
p_live += "Run and record exit status for EACH:\n";
p_live += "1) cd " + root + " && bun run typecheck\n";
p_live += "2) cd " + root + " && bun run typecheck:types\n";
p_live += "3) cd " + root + " && bun test packages/core packages/testkit\n";
p_live += "4) cd " + root + " && bun run check:boundaries\n";
p_live += "5) cd " + root + " && bun run check:runtime-portability\n";
p_live += "Capture test_summary like 'N pass, 0 fail, F files'.\n\n";
p_live += "Also run greps (record non-empty hits with file:line context in grep_hits[]):\n";
p_live += "A) Float money conversion risk:\n";
p_live += "   rg -n 'Math\\.round|amount \\* 100|amount \\* 10' packages/core/src/gateways packages/core/src/utils/money.ts\n";
p_live += "B) success treated as paid / fulfillment anti-patterns in docs or helpers:\n";
p_live += "   rg -n 'if \\(.*\\.success|success === true' packages/core/src packages/core/docs --glob '!*.test.ts' | head -40\n";
p_live += "C) node:/bun:/cloudflare: banned builtins in production src:\n";
p_live += "   rg -n 'from [\"'\\'']node:|from [\"'\\'']bun:|from [\"'\\'']cloudflare:|require\\([\"'\\'']node:' packages/core/src packages/testkit/src --glob '!*.test.ts'\n";
p_live += "D) TODO/FIXME/XXX stubs in phase 5-8 areas:\n";
p_live += "   rg -n 'TODO|FIXME|XXX|not implemented|throw new Error\\(.not' packages/core/src/utils/money.ts packages/core/src/types packages/core/src/runtime packages/core/src/gateways\n";
p_live += "E) Confirm key files exist:\n";
p_live += "   money.ts, operation-result.ts, domain-status.ts, provider-refs.ts, payment-event.ts,\n";
p_live += "   webhook-event-map.ts, payment-runtime.ts, crypto-portable.ts, abort.ts,\n";
p_live += "   docs: money.md, operation-results.md, webhook-events.md, runtime.md\n";
p_live += "F) Confirm STABLE_PAYMENT_EVENT_TYPES has 14 names; PaymentOperationResult 5 arms;\n";
p_live += "   MinorAmount = bigint; PaymentRuntime has fetch/crypto/clock/randomUUID\n";
p_live += "G) Confirm applyOutcomeToGatewayResult / attachPaymentEvent used in all 4 gateways\n";
p_live += "H) Confirm isPaidOutcome requires succeeded + paid-like status (not authorized alone)\n\n";
p_live += "Set ok=true only if typecheck, tests, boundaries, AND portability all pass.\n";
p_live += "Return full live_schema.\n";

let live = agent(p_live, #{
    label: "live:phase5-8-checks",
    capability_mode: "execute",
    output_schema: live_schema,
});

let live_ok = false;
let live_summary = "live agent failed";
let live_json = "{}";
if live != () && live.success && live.output != () {
    live_ok = live.output.ok == true;
    live_summary = live.output.summary;
    live_json = json_encode(live.output);
    log("Live checks ok=" + live_ok.to_string() + " — " + live_summary);
    write_scratch_file("audit-5-8-live.json", live_json);
} else {
    log("Live checks agent failed");
}

// ─── Phase audits (parallel) ─────────────────────────────────────
phase("Phase-Audit");
log("Deep auditing Phases 5, 6, 7, 8 in parallel");

let common_audit = "";
common_audit += "Repo root: " + root + "\n";
common_audit += "You are a FAIL-CLOSED auditor. Missing evidence = gap. Do NOT trust gate reports alone — re-read source.\n";
common_audit += "Use read_file, list_dir, grep extensively. Shell inspect-only is OK (rg via tools). Do NOT edit. Do NOT commit.\n";
common_audit += "Live check summary: " + live_summary + "\n";
common_audit += "For each roadmap task and acceptance criterion set status to exactly one of: PASS | PARTIAL | FAIL | N/A.\n";
common_audit += "blocking[] = must-fix before calling phase complete (real correctness/security/contract bugs).\n";
common_audit += "non_blocking[] = polish, docs, intentional 0.x limits, coverage nits.\n";
common_audit += "logic_bugs[] = incorrect control flow, wrong claims, false paid, silent rounding, secret leak, etc.\n";
common_audit += "dead_code[] = unused exports, unreachable branches, abandoned helpers, duplicate modules.\n";
common_audit += "missing_tests[] = behaviors claimed but untested.\n";
common_audit += "honest_gaps[] = intentional/documented limitations (not defects).\n";
common_audit += "Cite file paths and symbols in evidence strings. Prefer concrete over vague.\n";
common_audit += "Also read the corresponding gate report if present, but independently verify claims.\n\n";

let p5 = "";
p5 += common_audit;
p5 += "PHASE = 5 — Safe Money Model.\n";
p5 += "Read roadmap.md section '# Phase 5 — Safe Money Model' (Target API, Tasks 5.1-5.4, Acceptance).\n";
p5 += "Read packages/core/docs/baseline/phase-5-gate-report.md (verify, don't trust).\n\n";
p5 += "Inspect deeply:\n";
p5 += "- packages/core/src/utils/money.ts, currency.ts + money.test.ts, money.edge.test.ts, money.provider-profiles.test.ts\n";
p5 += "- All four gateways amount conversion paths (imports of utils/money)\n";
p5 += "- types payment.types AmountInput; validation schemas for amount\n";
p5 += "- packages/core/docs/money.md; public-api exports\n";
p5 += "- testkit mock amount tracking (minor units vs float)\n\n";
p5 += "Verify:\n";
p5 += "5.1 Money, DecimalString, MinorAmount(bigint), money(), getCurrencyExponent+overrides, parse/format\n";
p5 += "5.2 default rounding reject; explicit modes only when supplied\n";
p5 += "5.3 number | Money overload; migration docs; results may still be number in 0.x\n";
p5 += "5.4 edge cases 0/2/3 decimal, large, invalid precision, overrides, negative marketplace\n";
p5 += "A1 no binary float finance calc; A2 JSON plain {amount,currency}; A3 every gateway shared primitives\n";
p5 += "Logic: silent rounding; float leftover; unsafe Number(bigint); Money with bigint fields;\n";
p5 += "      Stripe three-decimal div-by-10; Paymob overrides ignored; number 0.1+0.2 path\n";
p5 += "Dead code: unused money helpers, amountInputToMajorNumber, YAGNI arithmetic, duplicate conversion in gateways.\n";
p5 += "Set phase=5. Return phase_audit_schema fully.\n";

let p6 = "";
p6 += common_audit;
p6 += "PHASE = 6 — Typed Provider Inputs and Operation Results.\n";
p6 += "Read roadmap.md section '# Phase 6 — Typed Provider Inputs and Operation Results' (Tasks 6.1-6.4, Acceptance).\n";
p6 += "Read packages/core/docs/baseline/phase-6-gate-report.md.\n\n";
p6 += "Inspect deeply:\n";
p6 += "- packages/core/src/types/operation-result.ts + operation-result.test.ts + operation-results.acceptance.test.ts\n";
p6 += "- packages/core/src/types/domain-status.ts, provider-refs.ts, payment.types.ts (CommonPaymentInput)\n";
p6 += "- base.gateway.ts after-hook identity freeze (MONEY_IDENTITY_KEYS / restoreMoneyIdentityFields)\n";
p6 += "- All 4 gateways: applyOutcomeToGatewayResult dual-write of outcome + references\n";
p6 += "- isPaidOutcome, inferOperationOutcome, successFromOutcome, mapGatewayResultToOperationResult\n";
p6 += "- packages/core/docs/operation-results.md; public-api.types.test.ts CommonKeys isolation\n";
p6 += "- testkit mock dual-write of outcome + references + indeterminate reconciliationRequired\n\n";
p6 += "Verify:\n";
p6 += "6.1 CommonPaymentInput only amount/orderId/description/metadata — no stripe/moyasar keys\n";
p6 += "6.2 PaymentOperationResult 5 arms: succeeded | requires_action | declined | failed | indeterminate\n";
p6 += "    indeterminate has reconciliationRequired: true literal\n";
p6 += "6.3 Separate domain status unions: payment, authorization, capture, refund, setup, dispute, transfer, payout\n";
p6 += "6.4 ProviderReferences: internal ref, provider object ID, request ID, parent/related, native+normalized status\n";
p6 += "A1 pending/requires_action cannot be mistaken for paid (isPaidOutcome + tests + after-hook forge protection)\n";
p6 += "A2 indeterminate outcomes explicit; success=false for indeterminate; not a decline substitute\n";
p6 += "A3 provider-specific fields do not pollute common inputs\n";
p6 += "Logic: isPaidOutcome treats authorized as paid (BUG); success dual-write confuses fulfillment;\n";
p6 += "      after-hook can forge paid; gateway omits applyOutcome; indeterminate without reconciliationRequired\n";
p6 += "Dead code: unused outcome arms, dead domain status, unused ProviderReferences fields helpers\n";
p6 += "Set phase=6. Return phase_audit_schema fully.\n";

let p7 = "";
p7 += common_audit;
p7 += "PHASE = 7 — Typed and Versioned Webhook Events.\n";
p7 += "Read roadmap.md section '# Phase 7 — Typed and Versioned Webhook Events' (Target Model, Tasks 7.1-7.5, Acceptance).\n";
p7 += "Read packages/core/docs/baseline/phase-7-gate-report.md.\n\n";
p7 += "Inspect deeply:\n";
p7 += "- packages/core/src/types/payment-event.ts, stable-payment-event-types.ts, webhook-event-map.ts, webhook.types.ts\n";
p7 += "- payment-event.test.ts, webhook-events.acceptance.test.ts\n";
p7 += "- All 4 gateways: attachPaymentEvent in parseWebhookEvent paths\n";
p7 += "- client handleWebhook safety-net when event.event is undefined\n";
p7 += "- toPersistedPaymentEventEnvelope, stripRawFromPaymentEvent, assertNoSecretsInEnvelope, payloadHash\n";
p7 += "- RawWebhookPayloadCodec, encryptRawWebhookPayload, RequestLocalWebhookContext\n";
p7 += "- packages/core/docs/webhook-events.md; testkit mock PaymentEvent dual-write\n\n";
p7 += "Verify:\n";
p7 += "7.1 Exactly the 14 stable names from roadmap + provider.unmapped escape hatch if present:\n";
p7 += "    payment.created, payment.processing, payment.authorized, payment.succeeded, payment.failed,\n";
p7 += "    payment.cancelled, capture.completed, refund.pending, refund.completed, refund.failed,\n";
p7 += "    payment_method.setup_completed, dispute.opened, dispute.updated, dispute.closed\n";
p7 += "7.2 ProviderEventMetadata: gateway, eventId, eventType, apiVersion?, livemode?, occurredAt, receivedAt, requestId?\n";
p7 += "7.3 PersistedPaymentEventEnvelope: schemaVersion, event, payloadHash, storedAt — NO rawPayload/secrets/headers\n";
p7 += "7.4 Raw payload retention explicit opt-in via codec; request-local only by default\n";
p7 += "7.5 schemaVersion: '1'; compatibility documented; meaning never silently changes\n";
p7 += "A1 handlers receive discriminated events (switch exhaustiveness tests)\n";
p7 += "A2 provider metadata remains available\n";
p7 += "A3 stable sanitized envelope persistable by inbox adapters\n";
p7 += "Logic: rawPayload leaked into envelope; secrets in assertNoSecrets; unmapped treated as succeeded;\n";
p7 += "      dual-write missing on a gateway; client safety-net missing; payloadHash non-portable crypto\n";
p7 += "Dead code: unused stable names, dead map tables, unused codec paths\n";
p7 += "Set phase=7. Return phase_audit_schema fully.\n";

let p8 = "";
p8 += common_audit;
p8 += "PHASE = 8 — Runtime Portability.\n";
p8 += "Read roadmap.md section '# Phase 8 — Runtime Portability' (Tasks 8.1-8.5, Acceptance).\n";
p8 += "Read packages/core/docs/baseline/phase-8-gate-report.md.\n\n";
p8 += "Inspect deeply:\n";
p8 += "- packages/core/src/runtime/payment-runtime.ts, crypto-portable.ts, crypto-provider.ts, clock.ts, abort.ts, index.ts\n";
p8 += "- payment-runtime.test.ts, crypto-portable.test.ts, abort.test.ts, gateway-runtime-injection.test.ts\n";
p8 += "- create-payment-client.ts runtime injection; gateway-context.ts; factories create(context)\n";
p8 += "- All 4 gateways: this.fetch / runtime usage; webhook HMAC via portable crypto (no node:crypto)\n";
p8 += "- scripts/check-runtime-portability.ts + tests; docs/workspace-boundaries.md empty node: allowlist\n";
p8 += "- packages/core/docs/runtime.md; behavioral-contracts.md §7 if present\n";
p8 += "- CI matrix (.github/workflows/ci.yml) for Node/Bun; consumer-smoke.mjs\n";
p8 += "- package engines node>=18 bun>=1.0.0\n\n";
p8 += "Verify:\n";
p8 += "8.1 PaymentRuntime: fetch, crypto (CryptoProvider), clock (Clock), randomUUID()\n";
p8 += "8.2 Prefer Web APIs; pure portable crypto fallbacks only; no production node: imports\n";
p8 += "8.3 AbortSignal on every network op: OperationRequestOptions.signal; combineAbortSignals; strip tests\n";
p8 += "8.4 Runtime test matrix: Node min/LTS, Bun min/latest, Deno smoke, Workers smoke — note honest gaps if SKIP\n";
p8 += "8.5 Published exports free of Node imports into Worker/Deno entry points\n";
p8 += "A1 core imports in supported runtimes; A2 webhook verify works cross-runtime; A3 provider HTTP no Node globals\n";
p8 += "Logic: gateway hardcodes global fetch ignoring injected runtime; node:crypto in webhook verify;\n";
p8 += "      AbortSignal not forwarded; timeout not cleared in finally; randomUUID from non-portable source only\n";
p8 += "Dead code: unused CryptoProvider methods, dead clock, unused abort helpers, abandoned runtime paths\n";
p8 += "Set phase=8. Return phase_audit_schema fully.\n";

let phase_jobs = [
    #{ prompt: p5, label: "audit:phase5", capability_mode: "execute", output_schema: phase_audit_schema },
    #{ prompt: p6, label: "audit:phase6", capability_mode: "execute", output_schema: phase_audit_schema },
    #{ prompt: p7, label: "audit:phase7", capability_mode: "execute", output_schema: phase_audit_schema },
    #{ prompt: p8, label: "audit:phase8", capability_mode: "execute", output_schema: phase_audit_schema },
];

let phase_results = parallel(phase_jobs);

let audits = [];
let candidate_findings = [];
let phase_i = 0;
while phase_i < phase_results.len() {
    let r = phase_results[phase_i];
    if r != () && r.success && r.output != () {
        audits.push(r.output);
        log("Phase " + r.output.phase.to_string() + " audit: " + r.output.summary);
        write_scratch_file("audit-phase-" + r.output.phase.to_string() + ".json", json_encode(r.output));
        if r.output.blocking != () {
            let bi = 0;
            while bi < r.output.blocking.len() {
                candidate_findings.push("P" + r.output.phase.to_string() + "-BLOCK: " + r.output.blocking[bi]);
                bi += 1;
            }
        }
        if r.output.logic_bugs != () {
            let li = 0;
            while li < r.output.logic_bugs.len() {
                candidate_findings.push("P" + r.output.phase.to_string() + "-LOGIC: " + r.output.logic_bugs[li]);
                li += 1;
            }
        }
        if r.output.dead_code != () {
            let di = 0;
            while di < r.output.dead_code.len() && di < 6 {
                candidate_findings.push("P" + r.output.phase.to_string() + "-DEAD: " + r.output.dead_code[di]);
                di += 1;
            }
        }
    } else {
        log("Phase audit slot " + phase_i.to_string() + " failed");
        candidate_findings.push("META: phase audit agent slot " + phase_i.to_string() + " failed — treat as incomplete coverage");
    }
    phase_i += 1;
}

// ─── Cross-cutting ───────────────────────────────────────────────
phase("Cross-Cut");
log("Cross-cutting dead code / consistency audit for phases 5-8");

let p_cross = "";
p_cross += "Cross-cutting audit across Phase 5–8 surfaces in " + root + ".\n";
p_cross += "READ-ONLY: read_file, grep, list_dir. Do NOT edit.\n";
p_cross += "Live: " + live_summary + "\n\n";
p_cross += "Investigate:\n";
p_cross += "1) DEAD CODE across money, operation-result, payment-event, runtime modules:\n";
p_cross += "   unused exports in index.ts never imported outside defining module/tests;\n";
p_cross += "   duplicate conversion helpers in gateways; abandoned codec paths; unused abort helpers.\n";
p_cross += "2) INCONSISTENCIES:\n";
p_cross += "   outcome dual-write missing on one gateway; PaymentEvent dual-write missing on one gateway;\n";
p_cross += "   isPaidOutcome docs vs implementation; Money types vs validation zod;\n";
p_cross += "   runtime injection wired for plugin path but not legacy path;\n";
p_cross += "   success dual-write vs isPaidOutcome messaging conflict in README.\n";
p_cross += "3) EXPORT SURFACE: public-api.test freeze lists match index.ts for Phase 5-8 symbols;\n";
p_cross += "   dist types present for money, operation-result, payment-event, runtime if dist exists.\n";
p_cross += "4) DOC DRIFT: money.md, operation-results.md, webhook-events.md, runtime.md, behavioral-contracts\n";
p_cross += "   vs actual API names / roadmap wording.\n";
p_cross += "5) REGRESSION: Phase 5 money still used by Phase 6 outcomes and Phase 7 events;\n";
p_cross += "   Phase 8 portable hash used by Phase 7 envelope payloadHash;\n";
p_cross += "   testkit dual-writes Phase 6+7 fields correctly; webhooks package if present doesn't break core contracts.\n";
p_cross += "6) BOUNDARIES: core has no testkit/webhooks circular dep; empty node: allowlist for portable prod.\n";
p_cross += "7) FALSE-PAID / SECURITY: after-hook forge paths; raw payload in envelopes; secret in logs.\n\n";
p_cross += "Return blocking, non_blocking, dead_code, inconsistencies, export_issues, doc_drift, regression_risks, summary.\n";

let cross = agent(p_cross, #{
    label: "audit:cross-cut-5-8",
    capability_mode: "execute",
    output_schema: cross_schema,
});

let cross_json = "{}";
if cross != () && cross.success && cross.output != () {
    log("Cross-cut: " + cross.output.summary);
    cross_json = json_encode(cross.output);
    write_scratch_file("audit-5-8-cross.json", cross_json);
    if cross.output.blocking != () {
        let cbi = 0;
        while cbi < cross.output.blocking.len() {
            candidate_findings.push("X-BLOCK: " + cross.output.blocking[cbi]);
            cbi += 1;
        }
    }
    if cross.output.dead_code != () {
        let cdi = 0;
        while cdi < cross.output.dead_code.len() && cdi < 6 {
            candidate_findings.push("X-DEAD: " + cross.output.dead_code[cdi]);
            cdi += 1;
        }
    }
    if cross.output.inconsistencies != () {
        let cii = 0;
        while cii < cross.output.inconsistencies.len() && cii < 8 {
            candidate_findings.push("X-INCONSIST: " + cross.output.inconsistencies[cii]);
            cii += 1;
        }
    }
    if cross.output.regression_risks != () {
        let cri = 0;
        while cri < cross.output.regression_risks.len() && cri < 4 {
            candidate_findings.push("X-REGRESS: " + cross.output.regression_risks[cri]);
            cri += 1;
        }
    }
} else {
    log("Cross-cut agent failed");
}

// Cap candidates for adversarial panel
let MAX_VERIFY = 28;
if candidate_findings.len() > MAX_VERIFY {
    log("Truncating " + candidate_findings.len().to_string() + " candidates to " + MAX_VERIFY.to_string());
    let trimmed = [];
    let ti = 0;
    while ti < MAX_VERIFY {
        trimmed.push(candidate_findings[ti]);
        ti += 1;
    }
    candidate_findings = trimmed;
}

log("Adversarial verify panel size=" + candidate_findings.len().to_string());

// ─── Verify findings ─────────────────────────────────────────────
phase("Verify-Findings");

let confirmed_blocking = [];
let confirmed_non_blocking = [];
let dismissed = [];

if candidate_findings.len() == 0 {
    log("No candidate findings from auditors — still report may note incomplete agents");
    if !live_ok {
        confirmed_blocking.push("Live checks failed: " + live_summary);
    }
} else {
    let vjobs = [];
    let fi = 0;
    while fi < candidate_findings.len() {
        let finding = candidate_findings[fi];
        let encoded = json_encode(finding);
        let p_v = "";
        p_v += "Adversarially verify this audit finding for " + root + ".\n";
        p_v += "Finding JSON: " + encoded + "\n\n";
        p_v += "You are a SKEPTIC. Default real=false unless you independently prove the issue with concrete code evidence.\n";
        p_v += "Use read_file/grep on the actual sources. Do NOT trust the finding text alone.\n";
        p_v += "If it is a false positive, incomplete reading, intentional documented design, or already fixed: real=false.\n";
        p_v += "If real: severity must be one of blocking | non_blocking.\n";
        p_v += "  blocking = correctness/security/contract break for Phase 5-8 acceptance:\n";
        p_v += "    float money conversion, false-paid, indeterminate not explicit, raw secrets in envelope,\n";
        p_v += "    node: in production portable entry, AbortSignal not honored on network ops,\n";
        p_v += "    after-hook forge paid, CommonPaymentInput pollution, missing dual-write causing wrong fulfillment.\n";
        p_v += "  non_blocking = dead code cleanup, docs drift, missing nice-to-have tests, intentional 0.x limits,\n";
        p_v += "    Deno/Workers smoke SKIP when static gate exists, incomplete CI matrix.\n";
        p_v += "evidence must quote file path + what you saw. reason explains verdict.\n";
        p_v += "Return verdict_schema.\n";
        vjobs.push(#{
            prompt: p_v,
            label: "verify-finding-" + fi.to_string(),
            capability_mode: "read-only",
            output_schema: verdict_schema,
        });
        fi += 1;
    }

    let verdicts = parallel(vjobs);
    let vi = 0;
    while vi < verdicts.len() {
        let v = verdicts[vi];
        let orig = candidate_findings[vi];
        if v != () && v.success && v.output != () && v.output.real == true
            && v.output.evidence != () && v.output.evidence != "" {
            let line = orig + " || " + v.output.reason + " || " + v.output.evidence;
            if v.output.severity == "blocking" {
                confirmed_blocking.push(line);
            } else {
                confirmed_non_blocking.push(line);
            }
        } else {
            let why = "no evidence";
            if v != () && v.success && v.output != () && v.output.reason != () {
                why = v.output.reason;
            }
            dismissed.push(orig + " || dismissed: " + why);
        }
        vi += 1;
    }
    log("Confirmed blocking=" + confirmed_blocking.len().to_string()
        + " non_blocking=" + confirmed_non_blocking.len().to_string()
        + " dismissed=" + dismissed.len().to_string());
}

if !live_ok {
    confirmed_blocking.push("LIVE-CHECKS-FAILED: " + live_summary);
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
log("Synthesizing Phase 5–8 audit report");

let findings_for_report = #{
    live_ok: live_ok,
    live_summary: live_summary,
    live: live_json,
    cross: cross_json,
    confirmed_blocking: confirmed_blocking,
    confirmed_non_blocking: confirmed_non_blocking,
    dismissed: dismissed,
    audits_count: audits.len(),
};

let phase5_summary = "phase 5 audit missing";
let phase6_summary = "phase 6 audit missing";
let phase7_summary = "phase 7 audit missing";
let phase8_summary = "phase 8 audit missing";
let ai = 0;
while ai < audits.len() {
    let a = audits[ai];
    if a.phase == 5 {
        phase5_summary = a.summary;
    }
    if a.phase == 6 {
        phase6_summary = a.summary;
    }
    if a.phase == 7 {
        phase7_summary = a.summary;
    }
    if a.phase == 8 {
        phase8_summary = a.summary;
    }
    ai += 1;
}

// Include full audit JSON for richer report (capped via json_encode of list)
let audits_json = json_encode(audits);

let p_report = "";
p_report += "Write the final Phase 5–8 deep audit report for " + root + ".\n";
p_report += "You MAY write ONE markdown file: packages/core/docs/baseline/phase-5-8-audit-report.md\n";
p_report += "Do NOT commit. Do NOT change production source (only the report markdown).\n\n";
p_report += "INPUTS (JSON findings):\n";
p_report += json_encode(findings_for_report) + "\n\n";
p_report += "Full phase audit outputs (JSON array):\n";
p_report += audits_json + "\n\n";
p_report += "Phase summaries:\n";
p_report += "P5: " + phase5_summary + "\n";
p_report += "P6: " + phase6_summary + "\n";
p_report += "P7: " + phase7_summary + "\n";
p_report += "P8: " + phase8_summary + "\n\n";
p_report += "Optionally re-verify a few critical claims with read_file/grep if uncertain, but prefer confirmed lists.\n\n";
p_report += "Report structure (markdown):\n";
p_report += "# Phase 5–8 Deep Audit Report\n";
p_report += "- Date, monorepo, fail-closed stance, overall PASS/FAIL\n";
p_report += "## Live checks (commands)\n";
p_report += "## Phase 5 roadmap compliance (tasks + acceptance table)\n";
p_report += "## Phase 6 roadmap compliance\n";
p_report += "## Phase 7 roadmap compliance\n";
p_report += "## Phase 8 roadmap compliance\n";
p_report += "## Cross-cutting findings\n";
p_report += "## Confirmed blocking findings (empty if none)\n";
p_report += "## Confirmed non-blocking findings\n";
p_report += "## Dismissed false positives (brief)\n";
p_report += "## Dead code / cleanup opportunities\n";
p_report += "## Verdict\n\n";
p_report += "pass=true ONLY if live checks ok AND confirmed_blocking is empty.\n";
p_report += "Populate blocking/non_blocking/dismissed arrays from confirmed lists (strings).\n";
p_report += "phase5/phase6/phase7/phase8 short status strings (e.g. 'PASS with N non-blocking').\n";
p_report += "report_path = packages/core/docs/baseline/phase-5-8-audit-report.md\n";
p_report += "Return report_schema.\n";

let report = agent(p_report, #{
    label: "report:phase5-8-audit",
    capability_mode: "all",
    output_schema: report_schema,
});

let pass = false;
let report_path = "";
let final_summary = "report agent failed";
let final_blocking = confirmed_blocking;
let final_non_blocking = confirmed_non_blocking;
let final_dismissed = dismissed;

if report != () && report.success && report.output != () {
    pass = report.output.pass == true;
    if confirmed_blocking.len() > 0 || !live_ok {
        pass = false;
    }
    if report.output.report_path != () {
        report_path = report.output.report_path;
    }
    final_summary = report.output.summary;
    if report.output.blocking != () {
        final_blocking = report.output.blocking;
    }
    if report.output.non_blocking != () {
        final_non_blocking = report.output.non_blocking;
    }
    if report.output.dismissed != () {
        final_dismissed = report.output.dismissed;
    }
    if report.output.phase5 != () {
        phase5_summary = report.output.phase5;
    }
    if report.output.phase6 != () {
        phase6_summary = report.output.phase6;
    }
    if report.output.phase7 != () {
        phase7_summary = report.output.phase7;
    }
    if report.output.phase8 != () {
        phase8_summary = report.output.phase8;
    }
    log("Report pass=" + pass.to_string() + " — " + final_summary);
    write_scratch_file("audit-5-8-report.json", json_encode(report.output));
} else {
    log("Report agent failed — computing pass from confirmed lists");
    pass = live_ok && confirmed_blocking.len() == 0;
    final_summary = "Report agent failed; pass derived from live_ok && empty blocking";
}

complete(#{
    phases: "5-8",
    pass: pass,
    live_ok: live_ok,
    blocking_count: final_blocking.len(),
    non_blocking_count: final_non_blocking.len(),
    dismissed_count: final_dismissed.len(),
    blocking: final_blocking,
    non_blocking: final_non_blocking,
    dismissed: final_dismissed,
    phase5: phase5_summary,
    phase6: phase6_summary,
    phase7: phase7_summary,
    phase8: phase8_summary,
    report_path: report_path,
    live_summary: live_summary,
    summary: final_summary,
});
