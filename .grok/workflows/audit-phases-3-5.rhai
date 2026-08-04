let meta = #{
    name: "audit-phases-3-5",
    description: "Deep audit of roadmap Phases 3–5: capabilities, testkit, safe money — roadmap compliance, logic bugs, dead code, tests",
    phases: [
        #{ title: "Live-Checks", detail: "typecheck, tests, boundaries, greps for known anti-patterns" },
        #{ title: "Phase-Audit", detail: "parallel deep audits for Phase 3, 4, 5 vs roadmap" },
        #{ title: "Cross-Cut", detail: "dead code, consistency, export surface, doc/code drift" },
        #{ title: "Verify-Findings", detail: "adversarial skeptics re-check each blocking candidate" },
        #{ title: "Report", detail: "synthesize fail-closed audit report" },
    ],
    when_to_use: "Deep review/audit of shipped Phase 3–5 work against roadmap.md without re-implementing",
};

let live_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "boundaries_ok", "test_summary", "grep_hits", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "typecheck_types_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "test_summary": #{ "type": "string" },
        "grep_hits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
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
    "required": ["pass", "blocking", "non_blocking", "dismissed", "phase3", "phase4", "phase5", "report_path", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "dismissed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "phase3": #{ "type": "string" },
        "phase4": #{ "type": "string" },
        "phase5": #{ "type": "string" },
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
p_live += "You are the live-check agent for a Phase 3–5 audit of the monorepo at " + root + ".\n";
p_live += "You MAY run shell commands. Prefer not to edit files; only fix if a command is blocked by a trivial local issue.\n";
p_live += "Do NOT commit. Do NOT push.\n\n";
p_live += "Run and record exit status for EACH:\n";
p_live += "1) cd " + root + " && bun run typecheck\n";
p_live += "2) cd " + root + " && bun run typecheck:types\n";
p_live += "3) cd " + root + " && bun test packages/core packages/testkit\n";
p_live += "4) cd " + root + " && bun run check:boundaries\n";
p_live += "Capture test_summary like 'N pass, 0 fail, F files'.\n\n";
p_live += "Also run greps (record non-empty hits with file:line context in grep_hits[]):\n";
p_live += "A) Math.round used with amount conversion in packages/core/src/gateways (float money risk)\n";
p_live += "   rg -n 'Math\\.round|amount \\* 100|amount \\* 10' packages/core/src/gateways packages/core/src/utils/money.ts\n";
p_live += "B) core depends on testkit: rg -n 'payments-testkit' packages/core/package.json packages/core/src\n";
p_live += "C) TODO/FIXME/XXX in phase 3-5 areas: rg -n 'TODO|FIXME|XXX|not implemented|throw new Error\\(.not' packages/core/src/gateways packages/core/src/utils/money.ts packages/testkit/src\n";
p_live += "D) Confirm key files exist: gateway-capabilities.ts, money.ts, packages/testkit/src/index.ts, docs/gateway-capabilities.md, docs/money.md\n";
p_live += "E) Confirm GATEWAY_CAPABILITY_KEYS has 15 keys via grep/read\n";
p_live += "F) Confirm toMinorUnits / MinorAmount / bigint in money.ts\n\n";
p_live += "Set ok=true only if typecheck, tests, boundaries all pass.\n";
p_live += "Return full live_schema.\n";

let live = agent(p_live, #{
    label: "live:phase3-5-checks",
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
    write_scratch_file("audit-3-5-live.json", live_json);
} else {
    log("Live checks agent failed");
}

// ─── Phase audits (parallel) ─────────────────────────────────────
phase("Phase-Audit");
log("Deep auditing Phases 3, 4, 5 in parallel");

let common_audit = "";
common_audit += "Repo root: " + root + "\n";
common_audit += "You are a FAIL-CLOSED auditor. Missing evidence = gap. Do NOT trust gate reports alone — re-read source.\n";
common_audit += "Use read_file, list_dir, grep extensively. Shell inspect-only is OK (rg, cat via tools). Do NOT edit. Do NOT commit.\n";
common_audit += "Live check summary: " + live_summary + "\n";
common_audit += "For each roadmap task and acceptance criterion set status to exactly one of: PASS | PARTIAL | FAIL | N/A.\n";
common_audit += "blocking[] = must-fix before calling phase complete (real correctness/security/contract bugs).\n";
common_audit += "non_blocking[] = polish, docs, intentional 0.x limits, coverage nits.\n";
common_audit += "logic_bugs[] = incorrect control flow, wrong claims, false paid, silent rounding, non-atomic claims, etc.\n";
common_audit += "dead_code[] = unused exports, unreachable branches, abandoned helpers, duplicate modules.\n";
common_audit += "missing_tests[] = behaviors claimed but untested.\n";
common_audit += "honest_gaps[] = intentional/documented limitations (not defects).\n";
common_audit += "Cite file paths and symbols in evidence strings. Prefer concrete over vague.\n";
common_audit += "Also read the corresponding gate report if present, but independently verify claims.\n\n";

let p3 = "";
p3 += common_audit;
p3 += "PHASE = 3 — Gateway Capabilities Model.\n";
p3 += "Read roadmap.md section '# Phase 3 — Gateway Capabilities Model' (Objective, Target Model, Tasks 3.1-3.4, Acceptance).\n";
p3 += "Read packages/core/docs/baseline/phase-3-gate-report.md for prior claims (verify, don't trust).\n\n";
p3 += "Inspect deeply:\n";
p3 += "- packages/core/src/gateways/gateway-capabilities.ts, builtin-capabilities.ts, capabilities-docs.ts\n";
p3 += "- gateway.interface.ts, base.gateway.ts, gateway-manifest.ts, gateway-registry.ts, factories.ts\n";
p3 += "- client.ts capability enforcement (partial amount, voids, refunds, payments)\n";
p3 += "- errors.ts OperationNotSupportedError metadata\n";
p3 += "- capability-claims.test.ts, gateway-capabilities.test.ts, capabilities-docs.test.ts, client tests\n";
p3 += "- packages/core/docs/gateway-capabilities.md + generate-capability-docs.ts\n";
p3 += "- public-api exports for capability keys/helpers\n\n";
p3 += "Verify specifically:\n";
p3 += "3.1 All stable keys: payments, immediateCapture, authorization, partialCapture, refunds, partialRefunds,\n";
p3 += "    voids, hostedCheckout, tokenization, customers, paymentMethods, marketplaceSplits, disputes,\n";
p3 += "    paymentLinks, providerRecurring\n";
p3 += "3.2 supports() + capabilities snapshot; claim-authoritative not method duck-typing alone\n";
p3 += "3.3 Docs generated from code (not hand-stale only)\n";
p3 += "3.4 Claim validation tests; true claims imply methods; factory/instance parity; freeze\n";
p3 += "A1 inspect before invoke; A2 unsupported fails with capability metadata; A3 generated docs\n";
p3 += "Logic: partial amount only when amount provided; full ops not blocked; legacy adapters without caps still work;\n";
p3 += "      no secret leakage in caps; honest built-in claims (Stripe hosted, Moyasar marketplace, etc.)\n";
p3 += "Dead code: CAPABILITY_OPERATION_MAP unused? dead helpers? unused exports?\n";
p3 += "Set phase=3. Return phase_audit_schema fully.\n";

let p4 = "";
p4 += common_audit;
p4 += "PHASE = 4 — Test Kit, Fault Injection, and Mock Gateway.\n";
p4 += "Read roadmap.md section '# Phase 4 — Test Kit, Fault Injection, and Mock Gateway' (Tasks 4.1-4.5, Acceptance).\n";
p4 += "Read packages/testkit/docs/phase-4-gate-report.md and/or packages/core/docs/baseline/phase-4-gate-report.md.\n\n";
p4 += "Inspect deeply:\n";
p4 += "- packages/testkit/src/index.ts public surface\n";
p4 += "- mock/mock-gateway.ts, outcomes.ts, webhook-helpers.ts + tests\n";
p4 += "- conformance/gateway-conformance.ts + tests; builtin/builtin-conformance + run-builtin-applicable\n";
p4 += "- storage/contracts.ts + three conformance suites + tests\n";
p4 += "- memory/* stores + fake-clock; fixtures/* safety\n";
p4 += "- package.json deps (testkit→core only; core must NOT depend on testkit)\n";
p4 += "- README NON-PRODUCTION banners\n\n";
p4 += "Verify every 4.1 case exists in suite (amount, status, decline, errors, network, timeout, safe retry,\n";
p4 += "idempotency, webhook verify/malformed, event norm, partial capture/refund, logging redaction,\n";
p4 += "cancellation, indeterminate) — list missing case names if any.\n";
p4 += "4.2 mock: scripted FIFO, latency/timeout, dual outcome provider_ok_client_timeout, partials, history,\n";
p4 += "    webhook sign helpers, AbortSignal, never false-paid on timeout.\n";
p4 += "4.3 storage: concurrency, fake-clock lease expiry, crash reclaim, hash conflicts, cleanup, withTransaction rollback.\n";
p4 += "4.4 fixture safety version + secret reject.\n";
p4 += "4.5 memory NON-PRODUCTION + fake time + leases.\n";
p4 += "A1 shared suites; A2 mock without real providers; A3 builtins pass applicable (offline).\n";
p4 += "Logic bugs: non-atomic memory claims (await between check/set); timeout→paid; double charge on idempotent retry;\n";
p4 += "          secret fixtures; live network in builtin suite.\n";
p4 += "Dead code: stub suites, unused contracts, exported but never used symbols, abandoned scripts.\n";
p4 += "Set phase=4. Return phase_audit_schema fully.\n";

let p5 = "";
p5 += common_audit;
p5 += "PHASE = 5 — Safe Money Model.\n";
p5 += "Read roadmap.md section '# Phase 5 — Safe Money Model' (Target API, Tasks 5.1-5.4, Acceptance).\n";
p5 += "Read packages/core/docs/baseline/phase-5-gate-report.md.\n\n";
p5 += "Inspect deeply:\n";
p5 += "- packages/core/src/utils/money.ts, currency.ts + money.test.ts, money.edge.test.ts, money.provider-profiles.test.ts\n";
p5 += "- All four gateways amount conversion paths (imports of utils/money)\n";
p5 += "- types payment.types AmountInput; validation schemas for amount\n";
p5 += "- packages/core/docs/money.md; public-api exports\n";
p5 += "- testkit mock amount tracking (minor units vs float)\n\n";
p5 += "Verify:\n";
p5 += "5.1 Money, DecimalString, MinorAmount(bigint), money(), getCurrencyExponent+overrides, parse/format\n";
p5 += "5.2 default rounding reject; explicit modes\n";
p5 += "5.3 number | Money overload; migration docs; results may still be number in 0.x\n";
p5 += "5.4 edge cases 0/2/3 decimal, large, invalid precision, overrides, negative marketplace\n";
p5 += "A1 no binary float finance calc; A2 JSON plain {amount,currency}; A3 every gateway shared primitives\n";
p5 += "Logic: silent rounding; float leftover; unsafe Number(bigint); Money with bigint fields;\n";
p5 += "      Stripe three-decimal div-by-10; Paymob overrides ignored; number 0.1+0.2 path\n";
p5 += "Dead code: unused money helpers, amountInputToMajorNumber, YAGNI arithmetic, duplicate conversion in gateways.\n";
p5 += "Set phase=5. Return phase_audit_schema fully.\n";

let phase_jobs = [
    #{ prompt: p3, label: "audit:phase3", capability_mode: "execute", output_schema: phase_audit_schema },
    #{ prompt: p4, label: "audit:phase4", capability_mode: "execute", output_schema: phase_audit_schema },
    #{ prompt: p5, label: "audit:phase5", capability_mode: "execute", output_schema: phase_audit_schema },
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
        // Collect blocking + logic_bugs as candidates for adversarial verify
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
            // Cap dead-code candidates to avoid budget blowup
            while di < r.output.dead_code.len() && di < 8 {
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
log("Cross-cutting dead code / consistency audit");

let p_cross = "";
p_cross += "Cross-cutting audit across Phase 3–5 surfaces in " + root + ".\n";
p_cross += "READ-ONLY: read_file, grep, list_dir. Do NOT edit.\n";
p_cross += "Live: " + live_summary + "\n\n";
p_cross += "Investigate:\n";
p_cross += "1) DEAD CODE: exported symbols never imported outside defining module/tests;\n";
p_cross += "   unused CAPABILITY_OPERATION_MAP / helpers; unused money arithmetic; unused testkit exports;\n";
p_cross += "   duplicate fromMinorUnits/toMinorUnits left in gateways; orphaned scripts.\n";
p_cross += "2) INCONSISTENCIES: factory manifest caps vs gateway instance; docs table vs builtin-capabilities;\n";
p_cross += "   testkit mock caps vs claimed; AmountInput accepted in types but rejected in zod;\n";
p_cross += "   client assertCapability vs BaseGateway.assertCapability divergence.\n";
p_cross += "3) EXPORT SURFACE: public-api.test freeze lists match index.ts; dist types after prior build if present.\n";
p_cross += "4) DOC DRIFT: money.md / gateway-capabilities.md / plugin-architecture / custom-gateways / testkit README\n";
p_cross += "   vs actual API names.\n";
p_cross += "5) BOUNDARIES: core package.json has no testkit; scripts/check-workspace-boundaries knows packages.\n";
p_cross += "6) REGRESSION RISKS: Phase 6+ packages (webhooks) interaction if present — note only if Phase 3-5 broken by later phases.\n\n";
p_cross += "Return blocking, non_blocking, dead_code, inconsistencies, export_issues, doc_drift, summary.\n";

let cross = agent(p_cross, #{
    label: "audit:cross-cut-3-5",
    capability_mode: "execute",
    output_schema: cross_schema,
});

let cross_json = "{}";
if cross != () && cross.success && cross.output != () {
    log("Cross-cut: " + cross.output.summary);
    cross_json = json_encode(cross.output);
    write_scratch_file("audit-3-5-cross.json", cross_json);
    if cross.output.blocking != () {
        let cbi = 0;
        while cbi < cross.output.blocking.len() {
            candidate_findings.push("X-BLOCK: " + cross.output.blocking[cbi]);
            cbi += 1;
        }
    }
    if cross.output.dead_code != () {
        let cdi = 0;
        while cdi < cross.output.dead_code.len() && cdi < 8 {
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
} else {
    log("Cross-cut agent failed");
}

// Cap candidates for adversarial panel
let MAX_VERIFY = 24;
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
        p_v += "  blocking = correctness/security/contract break for Phase 3-5 acceptance or money safety / false paid / non-atomic claim / secret leak / float money conversion.\n";
        p_v += "  non_blocking = dead code cleanup, docs drift, missing nice-to-have tests, intentional 0.x limits.\n";
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
    // Live failure is always blocking even if auditors missed it
    let has_live = false;
    let lbi = 0;
    while lbi < confirmed_blocking.len() {
        // simple presence check via substring not available; always push if live failed
        lbi += 1;
    }
    confirmed_blocking.push("LIVE-CHECKS-FAILED: " + live_summary);
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
log("Synthesizing Phase 3–5 audit report");

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

// Attach phase summaries if present
let phase3_summary = "phase 3 audit missing";
let phase4_summary = "phase 4 audit missing";
let phase5_summary = "phase 5 audit missing";
let ai = 0;
while ai < audits.len() {
    let a = audits[ai];
    if a.phase == 3 {
        phase3_summary = a.summary;
    }
    if a.phase == 4 {
        phase4_summary = a.summary;
    }
    if a.phase == 5 {
        phase5_summary = a.summary;
    }
    ai += 1;
}

let p_report = "";
p_report += "Write the final Phase 3–5 deep audit report for " + root + ".\n";
p_report += "You MAY write ONE markdown file: packages/core/docs/baseline/phase-3-5-audit-report.md\n";
p_report += "Do NOT commit. Do NOT change production source.\n\n";
p_report += "INPUTS (JSON):\n";
p_report += json_encode(findings_for_report) + "\n\n";
p_report += "Phase summaries:\n";
p_report += "P3: " + phase3_summary + "\n";
p_report += "P4: " + phase4_summary + "\n";
p_report += "P5: " + phase5_summary + "\n\n";
p_report += "Also re-read scratch if needed and the three phase audit JSON shapes from agent context.\n";
p_report += "If you can, re-read write_scratch files via listing is not available — use the JSON above as source of truth for confirmed items.\n\n";
p_report += "Report structure (markdown):\n";
p_report += "# Phase 3–5 Deep Audit Report\n";
p_report += "- Date, monorepo, fail-closed stance, overall PASS/FAIL\n";
p_report += "## Live checks (commands)\n";
p_report += "## Phase 3 roadmap compliance (tasks + acceptance table)\n";
p_report += "## Phase 4 roadmap compliance\n";
p_report += "## Phase 5 roadmap compliance\n";
p_report += "## Confirmed blocking findings (empty if none)\n";
p_report += "## Confirmed non-blocking findings\n";
p_report += "## Dismissed false positives (brief)\n";
p_report += "## Dead code / cleanup opportunities\n";
p_report += "## Verdict\n\n";
p_report += "pass=true ONLY if live checks ok AND confirmed_blocking is empty.\n";
p_report += "Populate blocking/non_blocking/dismissed arrays from confirmed lists (strings).\n";
p_report += "phase3/phase4/phase5 short status strings (e.g. 'PASS with N non-blocking').\n";
p_report += "report_path = packages/core/docs/baseline/phase-3-5-audit-report.md\n";
p_report += "Return report_schema.\n";

let report = agent(p_report, #{
    label: "report:phase3-5-audit",
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
    // Fail closed: also require no confirmed blocking and live ok
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
    if report.output.phase3 != () {
        phase3_summary = report.output.phase3;
    }
    if report.output.phase4 != () {
        phase4_summary = report.output.phase4;
    }
    if report.output.phase5 != () {
        phase5_summary = report.output.phase5;
    }
    log("Report pass=" + pass.to_string() + " — " + final_summary);
    write_scratch_file("audit-3-5-report.json", json_encode(report.output));
} else {
    log("Report agent failed — computing pass from confirmed lists");
    pass = live_ok && confirmed_blocking.len() == 0;
    final_summary = "Report agent failed; pass derived from live_ok && empty blocking";
}

complete(#{
    phases: "3-5",
    pass: pass,
    live_ok: live_ok,
    blocking_count: final_blocking.len(),
    non_blocking_count: final_non_blocking.len(),
    dismissed_count: final_dismissed.len(),
    blocking: final_blocking,
    non_blocking: final_non_blocking,
    dismissed: final_dismissed,
    phase3: phase3_summary,
    phase4: phase4_summary,
    phase5: phase5_summary,
    report_path: report_path,
    live_summary: live_summary,
    summary: final_summary,
});
