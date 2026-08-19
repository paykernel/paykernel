let meta = #{
    name: "paykernel-r8-money-pan-fix-gate",
    description: "Critic, fix, verify, and gate C-R8-FINGERPRINT-MONEY-PAN leftover",
    phases: [
        #{ title: "Review", detail: "scan leftover fingerprint production src" },
        #{ title: "Verify", detail: "adversarial re-read of each finding" },
        #{ title: "Fix", detail: "close confirmed leftover identity holes" },
        #{ title: "Check", detail: "run fingerprint tests and typecheck" },
        #{ title: "Gate", detail: "confirm JPY 1e12 four-way identity and PII hashing" },
        #{ title: "Report", detail: "write leftover result under docs/audits" },
    ],
    when_to_use: "After r8-diff-critic confirms C-R8-FINGERPRINT-MONEY-PAN; critic then fix then gate",
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["file", "issue"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let check_schema = #{
    "type": "object",
    "required": ["ok", "tests_ok", "typecheck_ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
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
        "confirmed_count": #{ "type": "number" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/paykernel"
} else {
    args.root
};

let allowed = [
    "packages/core/src/utils/idempotency.ts",
    "packages/core/src/utils/money.ts",
];

fn path_allowed(path, allow) {
    if type_of(path) != "string" { return false; }
    for p in allow {
        if path == p { return true; }
    }
    false
}

fn review_prompt(dimension, repo) {
    let p = "You are reviewing the C-R8-FINGERPRINT-MONEY-PAN leftover fix in PayKernel. ";
    p += "Dimension: " + dimension + ". ";
    p += "Repo: " + repo + ". Use read_file and grep. Do not answer from memory. Do not edit.\n";
    p += "READ packages/core/src/utils/idempotency.ts (fingerprintParams, redactForFingerprint, ";
    p += "isFingerprintMoneyAmountLeaf, tryCanonicalAmountCurrency, stableStringify). ";
    p += "Tests in packages/core/src/utils/utils.test.ts are evidence only — do not report test files.\n";
    p += "Intended leftover behavior (NOT a bug): skip value-level PAN hashing for Money amount leaves ";
    p += "when key is amount and sibling currency is a string, so money-canonicalization can collapse ";
    p += "money(1e12,JPY), {amount:\"1000000000000\",currency:JPY}, {amount:1000000000000,currency:JPY}, ";
    p += "and {amount:\"1000000000000.0\",currency:JPY} to one SHA-256. ";
    p += "Keep hashing true PAN / OTP / billing keys. Do not PAN-hash allow-listed ids. ";
    p += "Logger redact stays constant [REDACTED]. Amount without sibling currency still PAN-hashes. ";
    p += "C1 and r7 S19 closes stay closed. Pre-existing depth>6 constant REDACTED is not this leftover.\n";
    p += "Only report NEW mistakes in this leftover (logic, dead code, inverted skip, identity split). ";
    p += "file MUST be packages/core/src/utils/idempotency.ts or packages/core/src/utils/money.ts. ";
    p += "Report at most 8 concrete {file, issue}. Empty is valid only after you read the source.\n";
    p
}

phase("Review");
log("Reviewing C-R8-FINGERPRINT-MONEY-PAN leftover");

let dimensions = [
    "logic mistakes inverted skip conditions and identity splits",
    "dead code unused symbols unreachable branches leftover TODOs",
    "fence and fingerprint regressions vs S20 hashed PII leaves",
];

let jobs = [];
for d in dimensions {
    jobs.push(#{
        prompt: review_prompt(d, root),
        label: "review:" + d.sub_string(0, 24),
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}
let results = parallel(jobs);

let findings = [];
if results != () {
    for r in results {
        if r != () && r.success && r.output != () && r.output.findings != () {
            for f in r.output.findings {
                if f != () && path_allowed(f.file, allowed) && type_of(f.issue) == "string" && f.issue != "" {
                    findings.push(f);
                }
            }
        }
    }
}
log(findings.len().to_string() + " in-scope leftover findings");

phase("Verify");
let confirmed = [];
if findings.len() == 0 {
    log("No review findings to verify");
} else {
    let vjobs = [];
    for f in findings {
        let vp = "";
        vp += "Adversarially verify this leftover finding by reading CURRENT source at " + root + ".\n";
        vp += "file=" + f.file + "\nissue=" + f.issue + "\n";
        vp += "Set real=true ONLY with concrete evidence you independently inspected. Default real=false.\n";
        vp += "Intended leftover behavior (skip PAN-hash for amount+currency money leaves) is NOT a bug.\n";
        vp += "S20 hashed PII / allow-listed ids / logger constant REDACTED staying as designed is NOT a bug.\n";
        vjobs.push(#{
            prompt: vp,
            label: "verify:" + f.file,
            capability_mode: "read-only",
            output_schema: verdict_schema,
        });
    }
    let verdicts = parallel(vjobs);
    let i = 0;
    if verdicts != () {
        while i < verdicts.len() {
            let v = verdicts[i];
            if v != () && v.success && v.output != () && v.output.real == true
                && v.output.evidence != () && v.output.evidence != "" {
                confirmed.push(findings[i]);
            }
            i += 1;
        }
    }
    log(confirmed.len().to_string() + "/" + findings.len().to_string() + " survived verification");
}

phase("Fix");
if confirmed.len() == 0 {
    log("No confirmed leftover findings to fix");
} else {
    let fp = "";
    fp += "Fix confirmed leftover fingerprint identity issues in " + root + ".\n";
    fp += "Only edit packages/core/src/utils/idempotency.ts and matching tests in ";
    fp += "packages/core/src/utils/utils.test.ts. Do not reopen r7/C1. Do not commit.\n";
    fp += "Required invariant: money(1e12,\"JPY\"), {amount:\"1000000000000\",currency:\"JPY\"}, ";
    fp += "{amount:1000000000000,currency:\"JPY\"}, {amount:\"1000000000000.0\",currency:\"JPY\"} ";
    fp += "share one SHA-256. Keep hashing PAN/OTP/billing. Do not PAN-hash allow-listed ids.\n";
    fp += "Confirmed:\n";
    let ci = 0;
    while ci < confirmed.len() {
        let cf = confirmed[ci];
        if cf != () {
            fp += "- " + cf.file + ": " + cf.issue + "\n";
        }
        ci += 1;
    }
    let fix_agent = agent(fp, #{
        label: "fix:money-pan",
        capability_mode: "all",
        output_schema: implement_schema,
    });
    if fix_agent != () && fix_agent.success && fix_agent.output != () && fix_agent.output.summary != () {
        log("Fix: " + fix_agent.output.summary);
    }
}

phase("Check");
let cp = "";
cp += "In " + root + " run: bun test packages/core/src/utils/utils.test.ts\n";
cp += "Also run: bun run --cwd packages/core typecheck\n";
cp += "Reproduce C-R8 four-way JPY 1e12 fingerprints if tests are unclear.\n";
cp += "Return {ok, tests_ok, typecheck_ok, summary, failures}. Do not edit unless tests fail because of your check harness.\n";
let check_agent = agent(cp, #{
    label: "check:tests",
    capability_mode: "execute",
    output_schema: check_schema,
});
if check_agent != () && check_agent.success && check_agent.output != () && check_agent.output.summary != () {
    log("Check: " + check_agent.output.summary);
}

phase("Gate");
let gp = "";
gp += "Adversarially gate C-R8-FINGERPRINT-MONEY-PAN in " + root + ".\n";
gp += "Re-read packages/core/src/utils/idempotency.ts. Independently execute bun to fingerprint ";
gp += "money(1e12,\"JPY\"), {amount:\"1000000000000\",currency:\"JPY\"}, ";
gp += "{amount:1000000000000,currency:\"JPY\"}, and {amount:\"1000000000000.0\",currency:\"JPY\"}.\n";
gp += "pass=true only if all four share one SHA-256 AND billing/otp/Visa-vs-MC still do not collide ";
gp += "AND allow-listed 13-digit ids are not PAN-hashed AND amount without currency is still hashed.\n";
gp += "Write blocking IDs if the leftover hole remains. Do not invent extras. Do not edit source.\n";
let gate_agent = agent(gp, #{
    label: "gate:money-pan",
    capability_mode: "execute",
    output_schema: gate_schema,
});
let gate_pass = false;
let gate_summary = "gate did not return";
if gate_agent != () && gate_agent.success && gate_agent.output != () {
    if gate_agent.output.pass == true {
        gate_pass = true;
    }
    if gate_agent.output.summary != () {
        gate_summary = gate_agent.output.summary;
    }
}
log("Gate pass=" + gate_pass.to_string() + " " + gate_summary);

phase("Report");
let rp = "";
rp += "Write " + root + "/docs/audits/session-audit-r8-money-pan-gate-2026-08-19.md\n";
rp += "Leftover C-R8-FINGERPRINT-MONEY-PAN critic/fix/gate. ";
rp += "confirmed_count=" + confirmed.len().to_string() + " gate_pass=" + gate_pass.to_string() + "\n";
rp += "Gate summary: " + gate_summary + "\n";
if confirmed.len() > 0 {
    rp += "Confirmed leftover findings that were sent to fix:\n";
    let ri = 0;
    while ri < confirmed.len() {
        let cf = confirmed[ri];
        if cf != () {
            rp += "- " + cf.file + ": " + cf.issue + "\n";
        }
        ri += 1;
    }
}
rp += "Return {ok, report_path, summary, confirmed_count}. ok true only if gate passed.\n";
let report_agent = agent(rp, #{
    label: "report:write-gate",
    capability_mode: "read-write",
    output_schema: report_schema,
});
if report_agent != () && report_agent.success && report_agent.output != () && report_agent.output.summary != () {
    log("Report: " + report_agent.output.summary);
}

complete(#{
    confirmed_count: confirmed.len(),
    finding_count: findings.len(),
    gate_pass: gate_pass,
});
