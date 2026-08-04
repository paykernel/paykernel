let meta = #{
    name: "deep-audit-package",
    description: "Full monorepo deep audit of paykernel for logic bugs, correctness mistakes, security footguns, contract violations, and dead/inconsistent code — fail-closed with adversarial verification",
    phases: [
        #{ title: "Live-Checks", detail: "typecheck, full tests, boundaries, portability, anti-pattern greps" },
        #{ title: "Domain-Audit", detail: "parallel deep audits: core/gateways, webhooks/events, stores/adapters, recon/routing/obs" },
        #{ title: "Cross-Cut", detail: "cross-package consistency, false-paid, claim races, export surface, doc drift" },
        #{ title: "Verify-Findings", detail: "adversarial skeptics re-check each candidate with source evidence" },
        #{ title: "Report", detail: "synthesize fail-closed audit report under docs/" },
    ],
    when_to_use: "Deep review of the whole paykernel monorepo for mistakes and logical problems after phases ship",
};

let live_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "boundaries_ok", "portability_ok", "test_summary", "grep_hits", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "portability_ok": #{ "type": "boolean" },
        "lint_ok": #{ "type": "boolean" },
        "test_summary": #{ "type": "string" },
        "grep_hits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let domain_audit_schema = #{
    "type": "object",
    "required": [
        "domain", "blocking", "non_blocking", "logic_bugs", "security",
        "dead_code", "missing_tests", "honest_gaps", "summary"
    ],
    "properties": #{
        "domain": #{ "type": "string" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 35 },
        "logic_bugs": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "security": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "dead_code": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "missing_tests": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "honest_gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "inconsistencies": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "summary": #{ "type": "string" },
    },
};

let cross_schema = #{
    "type": "object",
    "required": ["blocking", "non_blocking", "logic_bugs", "security", "inconsistencies", "export_issues", "summary"],
    "properties": #{
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 35 },
        "logic_bugs": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "security": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "inconsistencies": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "export_issues": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "doc_drift": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "dead_code": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
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
    "required": ["pass", "blocking", "non_blocking", "dismissed", "report_path", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "dismissed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "domains": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 10 },
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
p_live += "You are the live-check agent for a FULL monorepo deep audit of paykernel at " + root + ".\n";
p_live += "You MAY run shell commands. Prefer not to edit files.\n";
p_live += "Do NOT commit. Do NOT push.\n\n";
p_live += "Run and record exit status for EACH (allow long timeouts; full suite can take minutes):\n";
p_live += "1) cd " + root + " && bun run typecheck\n";
p_live += "2) cd " + root + " && bun test  (root package.json test script)\n";
p_live += "3) cd " + root + " && bun run check:boundaries\n";
p_live += "4) cd " + root + " && bun run check:runtime-portability\n";
p_live += "5) cd " + root + " && bun run lint  (if fails note but don't block ok solely on style unless errors)\n";
p_live += "Capture test_summary like 'N pass, F fail, files'.\n\n";
p_live += "Also run greps (record non-empty hits with file:line in grep_hits[]):\n";
p_live += "A) Float money risks:\n";
p_live += "   rg -n 'Math\\.round|amount \\* 100|amount \\* 10|parseFloat|Number\\(.*amount' packages --glob '!**/dist/**' --glob '!**/*.test.ts' | head -50\n";
p_live += "B) False-paid / success-as-fulfillment:\n";
p_live += "   rg -n 'isPaidOutcome|success === true|\\.success\\b' packages/core/src --glob '!**/*.test.ts' | head -40\n";
p_live += "C) Banned portable builtins in core/testkit/webhooks/recon/routing/obs production src:\n";
p_live += "   rg -n 'from [\"'\\'']node:|from [\"'\\'']bun:|from [\"'\\'']cloudflare:|require\\([\"'\\'']node:' packages/core/src packages/testkit/src packages/webhooks/src packages/reconciliation/src packages/routing/src packages/observability/src --glob '!**/*.test.ts'\n";
p_live += "D) TODO/FIXME/not implemented:\n";
p_live += "   rg -n 'TODO|FIXME|XXX|not implemented|throw new Error\\([\"'\\'']not ' packages --glob '!**/dist/**' --glob '!**/node_modules/**' | head -40\n";
p_live += "E) Any type / as any / @ts-ignore in production src:\n";
p_live += "   rg -n ': any\\b|as any|@ts-ignore|@ts-expect-error' packages --glob '!**/dist/**' --glob '!**/*.test.ts' | head -40\n";
p_live += "F) Secrets logging risks:\n";
p_live += "   rg -n 'secret_token|webhook_secret|apiKey|api_key|authorization' packages --glob '!**/dist/**' --glob '!**/*.md' | head -30\n";
p_live += "G) Claim/lease race patterns:\n";
p_live += "   rg -n 'UPDATE.*lease|lease_token|fencing|claim' packages --glob '!**/dist/**' --glob '!**/*.md' | head -30\n\n";
p_live += "Set ok=true only if typecheck, tests, boundaries, AND portability all pass.\n";
p_live += "Return full live_schema.\n";

let live = agent(p_live, #{
    label: "live:full-package-checks",
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
    write_scratch_file("deep-audit-live.json", live_json);
} else {
    log("Live checks agent failed");
}

// ─── Domain audits (parallel) ────────────────────────────────────
phase("Domain-Audit");
log("Deep auditing monorepo domains in parallel");

let common_audit = "";
common_audit += "Repo root: " + root + "\n";
common_audit += "You are a FAIL-CLOSED auditor hunting REAL mistakes and LOGICAL problems.\n";
common_audit += "Do NOT trust gate reports alone — re-read source. Missing evidence = gap.\n";
common_audit += "Use read_file, list_dir, grep extensively. Shell inspect-only OK. Do NOT edit. Do NOT commit.\n";
common_audit += "Live check summary: " + live_summary + "\n";
common_audit += "blocking[] = must-fix correctness/security/contract bugs that can lose money, double-fulfill, leak secrets, race claims, or break public contracts.\n";
common_audit += "non_blocking[] = polish, docs, intentional 0.x limits, coverage nits, dead code cleanup.\n";
common_audit += "logic_bugs[] = incorrect control flow, wrong status mapping, false paid, silent rounding, wrong comparison bases, race windows, dual-write skew.\n";
common_audit += "security[] = secret retention/leak, open redirect/schemes, unguarded crypto, missing replay windows, timing, auth bypass.\n";
common_audit += "dead_code[] = unused exports, unreachable branches, abandoned helpers.\n";
common_audit += "missing_tests[] = claimed behaviors untested.\n";
common_audit += "honest_gaps[] = intentional/documented limitations (not defects).\n";
common_audit += "Cite file paths and symbols. Prefer concrete over vague. Prefer proven bugs over style nits.\n\n";

// Domain A — Core orchestration + money + outcomes + all gateways
let p_a = "";
p_a += common_audit;
p_a += "DOMAIN = core-gateways\n";
p_a += "Scope: packages/core (orchestration, money, outcomes, hooks, all 4 gateways).\n\n";
p_a += "Deep-inspect:\n";
p_a += "- packages/core/src/client.ts, create-payment-client.ts, errors.ts\n";
p_a += "- packages/core/src/hooks/* (after-hook money identity freeze; webhook hook throw matrix)\n";
p_a += "- packages/core/src/utils/money.ts, currency.ts\n";
p_a += "- packages/core/src/types/operation-result.ts, domain-status.ts, provider-refs.ts, payment.types.ts, validation\n";
p_a += "- packages/core/src/gateways/** (base + stripe + paypal + paymob + moyasar)\n";
p_a += "- packages/core/src/runtime/** (portability, abort, crypto)\n";
p_a += "- packages/core/src/types/payment-event.ts, webhook-event-map.ts\n";
p_a += "- Key tests and docs under packages/core/docs for claimed behavior\n\n";
p_a += "Hunt specifically (historical + residual risk):\n";
p_a += "PAYPAL: verifyWebhook re-serialize raw body; transmission-time replay window; final_capture default; capture id extraction; sync verify soft-fail\n";
p_a += "STRIPE: refund compare amount_refunded vs amount_received/captured; partially_captured; webhook timestamp future-skew; charge.refunded base amount\n";
p_a += "PAYMOB: is_auth before captured_amount; refunded_amount without flags; AUTH payment_type\n";
p_a += "MOYASAR: verified→status mapping; 3ds error class; capture/refund without idempotency; secret_token in rawPayload\n";
p_a += "CORE: after-hook proceed:false after money moved; onWebhookVerified double-fulfill on throw; Error.captureStackTrace; amount .finite(); callbackUrl schemes; isPaidOutcome authorized≠paid; Money float paths; AbortSignal not forwarded\n";
p_a += "Also: dual-write of outcome+event missing on any gateway; forge-paid via hooks; unmapped webhook treated as succeeded\n\n";
p_a += "Set domain='core-gateways'. Return domain_audit_schema fully.\n";

// Domain B — Webhooks package + inbox semantics
let p_b = "";
p_b += common_audit;
p_b += "DOMAIN = webhooks-inbox\n";
p_b += "Scope: packages/webhooks + core webhook event dual-write contracts used by inbox.\n\n";
p_b += "Deep-inspect:\n";
p_b += "- packages/webhooks/src/** (engine, claim, lease, modes, outcomes, fencing)\n";
p_b += "- packages/webhooks/docs/**\n";
p_b += "- packages/core PaymentEvent envelope / raw retention contracts inbox depends on\n";
p_b += "- testkit memory inbox if present\n\n";
p_b += "Hunt:\n";
p_b += "- Double processing after crash mid-handler\n";
p_b += "- Lease renewal / fencing token not checked on complete\n";
p_b += "- Claim race allowing two workers same event\n";
p_b += "- ACK policy wrong for indeterminate\n";
p_b += "- Secrets or raw body persisted by default\n";
p_b += "- Mode confusion (at-least-once vs effectively-once claims)\n";
p_b += "- Dead letter / retry infinite loops\n";
p_b += "- Engine imports node: / non-portable APIs\n";
p_b += "- Processing outcome not distinguishing success vs handler throw vs poison\n\n";
p_b += "Set domain='webhooks-inbox'. Return domain_audit_schema fully.\n";

// Domain C — Stores, sql foundation, all adapters
let p_c = "";
p_c += common_audit;
p_c += "DOMAIN = stores-adapters\n";
p_c += "Scope: internal/sql-store + store-postgres + store-redis + store-sqlite + store-turso + store-d1 + store-durable-objects + testkit store contracts + phase-18 matrix honesty.\n\n";
p_c += "Deep-inspect:\n";
p_c += "- packages/testkit store contracts / manifests\n";
p_c += "- internal/sql-store claims, migrations, schema, codecs\n";
p_c += "- each store package src: claim implementations, lease fencing, migrations policy\n";
p_c += "- docs/adapter-selection.md, docs/adapter-capability-matrix.json, docs/workspace-boundaries.md\n";
p_c += "- phase gate reports 9-18 only as claims to re-verify, not truth\n\n";
p_c += "Hunt:\n";
p_c += "- Non-atomic multi-statement claims where race possible\n";
p_c += "- Fencing token ignored on release/complete\n";
p_c += "- Multi-host advertised for single-host sqlite\n";
p_c += "- Redis as sole audit store without caveats\n";
p_c += "- D1/DO/Turso/SQLite confused in APIs or docs\n";
p_c += "- Migration auto-run on import (dangerous)\n";
p_c += "- Clock skew on lease expiry\n";
p_c += "- Idempotency key collisions / incomplete unique constraints\n";
p_c += "- Error taxonomy swallowing vs throwing inconsistently\n";
p_c += "- Matrix honesty: capability matrix vs real code\n";
p_c += "- SQL injection via string concat\n";
p_c += "- Schema namespace collisions\n\n";
p_c += "Set domain='stores-adapters'. Return domain_audit_schema fully.\n";

// Domain D — Reconciliation + routing + observability
let p_d = "";
p_d += common_audit;
p_d += "DOMAIN = recon-routing-obs\n";
p_d += "Scope: packages/reconciliation + packages/routing + packages/observability (+ opentelemetry bridge).\n\n";
p_d += "Deep-inspect:\n";
p_d += "- packages/reconciliation/src/** (safe lookup, drift, decision-only policy, schedule, crash boundaries)\n";
p_d += "- packages/routing/src/** (select-only, amount ranges, post-attempt fallback eligibility)\n";
p_d += "- packages/observability/src/** (metrics, spans, redaction, context, otel bridge optional)\n";
p_d += "- package docs and gate reports 19-21 as claims to re-verify\n\n";
p_d += "Hunt RECONCILIATION:\n";
p_d += "- Policy that auto-captures/refunds (must be decision-only)\n";
p_d += "- Safe lookup treating network error as not-found → wrong side effect\n";
p_d += "- Drift detection false paid/false unpaid\n";
p_d += "- Schedule double-fire without store claim\n";
p_d += "- Crash mid-reconcile leaving inconsistent side effects\n\n";
p_d += "Hunt ROUTING:\n";
p_d += "- Auto multi-gateway retry after indeterminate (FORBIDDEN by non-goals)\n";
p_d += "- Amount range float comparison\n";
p_d += "- Fallback eligibility too broad (retry money-moved states)\n";
p_d += "- Selection ignores capability model\n";
p_d += "- Mutates payment after select in ways that break money identity\n\n";
p_d += "Hunt OBSERVABILITY:\n";
p_d += "- Hard OTEL dependency in core (must not)\n";
p_d += "- Redaction misses secrets/PII (PAN, tokens, auth headers)\n";
p_d += "- Metrics high-cardinality labels (full order ids unbounded)\n";
p_d += "- Span attributes leaking secrets\n";
p_d += "- Context propagation broken across hooks\n\n";
p_d += "Set domain='recon-routing-obs'. Return domain_audit_schema fully.\n";

let domain_jobs = [
    #{ prompt: p_a, label: "audit:core-gateways", capability_mode: "execute", output_schema: domain_audit_schema },
    #{ prompt: p_b, label: "audit:webhooks-inbox", capability_mode: "execute", output_schema: domain_audit_schema },
    #{ prompt: p_c, label: "audit:stores-adapters", capability_mode: "execute", output_schema: domain_audit_schema },
    #{ prompt: p_d, label: "audit:recon-routing-obs", capability_mode: "execute", output_schema: domain_audit_schema },
];

let domain_results = parallel(domain_jobs);

let audits = [];
let candidate_findings = [];
let di = 0;
while di < domain_results.len() {
    let r = domain_results[di];
    if r != () && r.success && r.output != () {
        audits.push(r.output);
        log("Domain " + r.output.domain + " audit: " + r.output.summary);
        write_scratch_file("deep-audit-domain-" + r.output.domain + ".json", json_encode(r.output));
        if r.output.blocking != () {
            let bi = 0;
            while bi < r.output.blocking.len() {
                candidate_findings.push("[" + r.output.domain + "] BLOCK: " + r.output.blocking[bi]);
                bi += 1;
            }
        }
        if r.output.logic_bugs != () {
            let li = 0;
            while li < r.output.logic_bugs.len() {
                candidate_findings.push("[" + r.output.domain + "] LOGIC: " + r.output.logic_bugs[li]);
                li += 1;
            }
        }
        if r.output.security != () {
            let si = 0;
            while si < r.output.security.len() {
                candidate_findings.push("[" + r.output.domain + "] SEC: " + r.output.security[si]);
                si += 1;
            }
        }
        if r.output.dead_code != () {
            let dci = 0;
            while dci < r.output.dead_code.len() && dci < 5 {
                candidate_findings.push("[" + r.output.domain + "] DEAD: " + r.output.dead_code[dci]);
                dci += 1;
            }
        }
        if r.output.inconsistencies != () {
            let ii = 0;
            while ii < r.output.inconsistencies.len() && ii < 5 {
                candidate_findings.push("[" + r.output.domain + "] INCONSIST: " + r.output.inconsistencies[ii]);
                ii += 1;
            }
        }
    } else {
        log("Domain audit slot " + di.to_string() + " failed");
        candidate_findings.push("META: domain audit agent slot " + di.to_string() + " failed — incomplete coverage");
    }
    di += 1;
}

// ─── Cross-cutting ───────────────────────────────────────────────
phase("Cross-Cut");
log("Cross-cutting monorepo consistency audit");

let p_cross = "";
p_cross += "Cross-cutting deep audit of entire paykernel monorepo at " + root + ".\n";
p_cross += "READ-ONLY. Do NOT edit. Live: " + live_summary + "\n\n";
p_cross += "Investigate:\n";
p_cross += "1) FALSE-PAID / FULFILLMENT safety across core + recon + routing + docs\n";
p_cross += "2) CLAIM/LEASE fencing consistency: webhooks engine vs all store adapters vs testkit memory\n";
p_cross += "3) MONEY: all packages use core money primitives; no float ranges in routing/recon\n";
p_cross += "4) PORTABILITY: domain packages free of node:/bun:/cloudflare:; adapters isolate runtime imports\n";
p_cross += "5) EXPORT SURFACE: each package.json exports map vs index.ts vs public-api tests\n";
p_cross += "6) DOC/MATRIX honesty: adapter-selection.md + capability matrix vs code manifests\n";
p_cross += "7) WORKSPACE boundaries: private internal-sql-store not re-exported; no circular deps\n";
p_cross += "8) IDEMPOTENCY: mutation paths require store+key guidance; missing key footguns documented\n";
p_cross += "9) WEBHOOK dual-write: all gateways + mock produce PaymentEvent; inbox consumes envelope without secrets\n";
p_cross += "10) NON-GOALS violated: auto multi-gateway retry after indeterminate; required Redis; single CF package lie\n\n";
p_cross += "Return blocking, non_blocking, logic_bugs, security, inconsistencies, export_issues, doc_drift, dead_code, regression_risks, summary.\n";

let cross = agent(p_cross, #{
    label: "audit:cross-cut-full",
    capability_mode: "execute",
    output_schema: cross_schema,
});

let cross_json = "{}";
if cross != () && cross.success && cross.output != () {
    log("Cross-cut: " + cross.output.summary);
    cross_json = json_encode(cross.output);
    write_scratch_file("deep-audit-cross.json", cross_json);
    if cross.output.blocking != () {
        let cbi = 0;
        while cbi < cross.output.blocking.len() {
            candidate_findings.push("[cross] BLOCK: " + cross.output.blocking[cbi]);
            cbi += 1;
        }
    }
    if cross.output.logic_bugs != () {
        let cli = 0;
        while cli < cross.output.logic_bugs.len() {
            candidate_findings.push("[cross] LOGIC: " + cross.output.logic_bugs[cli]);
            cli += 1;
        }
    }
    if cross.output.security != () {
        let csi = 0;
        while csi < cross.output.security.len() {
            candidate_findings.push("[cross] SEC: " + cross.output.security[csi]);
            csi += 1;
        }
    }
    if cross.output.inconsistencies != () {
        let cii = 0;
        while cii < cross.output.inconsistencies.len() && cii < 8 {
            candidate_findings.push("[cross] INCONSIST: " + cross.output.inconsistencies[cii]);
            cii += 1;
        }
    }
    if cross.output.regression_risks != () {
        let cri = 0;
        while cri < cross.output.regression_risks.len() && cri < 5 {
            candidate_findings.push("[cross] REGRESS: " + cross.output.regression_risks[cri]);
            cri += 1;
        }
    }
    if cross.output.dead_code != () {
        let cdd = 0;
        while cdd < cross.output.dead_code.len() && cdd < 5 {
            candidate_findings.push("[cross] DEAD: " + cross.output.dead_code[cdd]);
            cdd += 1;
        }
    }
} else {
    log("Cross-cut agent failed");
}

// Deduplicate exact candidate strings
let unique = [];
let ui = 0;
while ui < candidate_findings.len() {
    let item = candidate_findings[ui];
    let seen = false;
    let uj = 0;
    while uj < unique.len() {
        if unique[uj] == item {
            seen = true;
        }
        uj += 1;
    }
    if !seen {
        unique.push(item);
    }
    ui += 1;
}
candidate_findings = unique;

// Cap candidates for adversarial panel
let MAX_VERIFY = 36;
if candidate_findings.len() > MAX_VERIFY {
    log("Truncating " + candidate_findings.len().to_string() + " candidates to " + MAX_VERIFY.to_string() + " (prefer earlier BLOCK/LOGIC/SEC)");
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
    log("No candidate findings from auditors");
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
        p_v += "Adversarially verify this audit finding for paykernel at " + root + ".\n";
        p_v += "Finding JSON: " + encoded + "\n\n";
        p_v += "You are a SKEPTIC. Default real=false unless you independently prove the issue with concrete code evidence.\n";
        p_v += "Use read_file/grep on actual sources. Do NOT trust the finding text alone.\n";
        p_v += "If false positive, incomplete reading, intentional documented design, or already fixed: real=false.\n";
        p_v += "If real: severity must be one of blocking | non_blocking.\n";
        p_v += "  blocking = money loss, double fulfill, false paid, claim race, secret leak, contract break,\n";
        p_v += "    non-atomic claim under concurrency, auto multi-gateway retry after indeterminate,\n";
        p_v += "    wrong refund/capture comparison base, raw secret in persisted envelope.\n";
        p_v += "  non_blocking = dead code, docs drift, missing nice tests, intentional 0.x limits, style.\n";
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
log("Synthesizing full package deep-audit report");

let domain_summaries = [];
let ai = 0;
while ai < audits.len() {
    domain_summaries.push(audits[ai].domain + ": " + audits[ai].summary);
    ai += 1;
}

let findings_for_report = #{
    live_ok: live_ok,
    live_summary: live_summary,
    live: live_json,
    cross: cross_json,
    confirmed_blocking: confirmed_blocking,
    confirmed_non_blocking: confirmed_non_blocking,
    dismissed: dismissed,
    domain_summaries: domain_summaries,
    audits_count: audits.len(),
};

let p_report = "";
p_report += "Write a fail-closed deep audit report for the paykernel monorepo at " + root + ".\n";
p_report += "You MAY write ONE markdown file: " + root + "/docs/deep-audit-package-report.md\n";
p_report += "Do NOT commit. Do NOT push. Do NOT edit source.\n\n";
p_report += "INPUT JSON (verified findings + context):\n";
p_report += json_encode(findings_for_report) + "\n\n";
p_report += "Report structure (markdown):\n";
p_report += "# PayKernel monorepo deep audit report\n";
p_report += "- Date (UTC), verdict PASS|FAIL, auditor notes\n";
p_report += "- Live checks summary\n";
p_report += "- Domain audit summaries\n";
p_report += "- ## Blocking findings (numbered, with evidence)\n";
p_report += "- ## Non-blocking findings\n";
p_report += "- ## Dismissed / false positives (brief)\n";
p_report += "- ## Recommended fix priority\n";
p_report += "- ## Honest gaps (documented limits)\n\n";
p_report += "pass=true only if confirmed_blocking is empty AND live_ok was true (or live was re-verified pass).\n";
p_report += "report_path must be the absolute path written.\n";
p_report += "blocking/non_blocking/dismissed arrays should be cleaned human-readable lines (not raw JSON dumps).\n";
p_report += "Return report_schema.\n";

let report = agent(p_report, #{
    label: "report:deep-audit-package",
    capability_mode: "execute",
    output_schema: report_schema,
});

if report != () && report.success && report.output != () {
    log("Report pass=" + report.output.pass.to_string() + " path=" + report.output.report_path);
    log("Summary: " + report.output.summary);
    write_scratch_file("deep-audit-report.json", json_encode(report.output));
} else {
    log("Report agent failed — writing fallback summary");
    let fallback = "";
    fallback += "# PayKernel monorepo deep audit report (fallback)\n\n";
    fallback += "Live: " + live_summary + "\n\n";
    fallback += "## Blocking\n";
    let fbi = 0;
    while fbi < confirmed_blocking.len() {
        fallback += "- " + confirmed_blocking[fbi] + "\n";
        fbi += 1;
    }
    fallback += "\n## Non-blocking\n";
    let fni = 0;
    while fni < confirmed_non_blocking.len() {
        fallback += "- " + confirmed_non_blocking[fni] + "\n";
        fni += 1;
    }
    fallback += "\n## Dismissed\n";
    let fdi = 0;
    while fdi < dismissed.len() && fdi < 30 {
        fallback += "- " + dismissed[fdi] + "\n";
        fdi += 1;
    }
    // best-effort write via agent already failed; leave scratch
    write_scratch_file("deep-audit-report-fallback.md", fallback);
}

log("deep-audit-package workflow complete");
