let meta = #{
    name: "paykernel-docs-code-critic",
    description: "Read-only deep review of Nimbus docs vs shipped PayKernel source; confirm only evidence-backed conflicts",
    phases: [
        #{ title: "Mechanical", detail: "run claim-checker script against MDX specifiers" },
        #{ title: "Review", detail: "one critic per docs shard vs matching src/index.ts" },
        #{ title: "Verify", detail: "adversarial re-read of each alleged docs-vs-code conflict" },
        #{ title: "Report", detail: "scratch report of confirmed conflicts only" },
    ],
    when_to_use: "After the PayKernel Nimbus docs site exists; hunt docs-vs-code conflicts before npm publish",
};

let mechanical_schema = #{
    "type": "object",
    "required": ["ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "exit_code": #{ "type": "integer" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
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

let report_schema = #{
    "type": "object",
    "required": ["ok", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "confirmed_count": #{ "type": "integer" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/paykernel"
} else {
    args.root
};

let spec = root + "/.grok/docs-site-spec.md";
let docs = root + "/apps/docs/src/content/docs";
let prefix = "apps/docs/src/content/docs/";

fn starts_with(s, pfx) {
    if type_of(s) != "string" { return false; }
    if type_of(pfx) != "string" { return false; }
    if s.len() < pfx.len() { return false; }
    s.sub_string(0, pfx.len()) == pfx
}

fn path_ok(path, pfx) {
    if starts_with(path, pfx) { return true; }
    if type_of(path) != "string" { return false; }
    if type_of(pfx) != "string" { return false; }
    if pfx.len() == 0 { return false; }
    if path.len() < pfx.len() { return false; }
    let i = 0;
    while i + pfx.len() <= path.len() {
        if path.sub_string(i, pfx.len()) == pfx { return true; }
        i += 1;
    }
    false
}

fn safe_summary(r) {
    if r == () { return "no-result"; }
    if !r.success { return "failed"; }
    if r.output == () { return "empty-output"; }
    if r.output.summary == () { return "ok"; }
    r.output.summary
}

fn critic_rules(repo, spec_path, mdx_prefix) {
    let p = "";
    p += "READ-ONLY docs-vs-code critic. Repo: " + repo + ".\n";
    p += "Read " + spec_path + " then the MDX files and matching source listed below. Use read_file and grep. Do not edit. Do not answer from memory.\n";
    p += "Compare EVERY claim in your MDX shard to shipped code: package.json name/exports/version, src/index.ts exports, implementation of named functions, env vars, HTTP routes, defaults, error classes.\n";
    p += "A finding is a CONFLICT: the docs say X and the code does Y (or the symbol/subpath/export does not exist). Cite both the MDX path and the source file:line in issue.\n";
    p += "NOT a finding: style, missing extra examples, lastUpdated git dates, Nimbus chrome, OG images, /index vs / alias, unpublished-to-npm honesty that matches 0.1.0-next.0.\n";
    p += "Hunt especially: invented exports/subpaths; @paykernel/observability; install of internal-sql-store; fulfill in onWebhookVerified; createPayment after indeterminate; sqlite/memory as multi-host; turso /sync; D1=DO; HTTP status owned by @paykernel/webhooks; success:true as paid; wrong factory names; samples that cannot typecheck against index.ts.\n";
    p += "file MUST be a path starting with " + mdx_prefix + " (the MDX file). issue must name the contradicting source path.\n";
    p += "At most 8 {file, issue}. Empty findings is valid ONLY after you opened the MDX and the matching src/index.ts / package.json.\n";
    p
}

// ─── Mechanical ──────────────────────────────────────────────────
phase("Mechanical");
log("Running check-doc-claims.ts");

let p_mech = "";
p_mech += "EXECUTE the docs claim checker. Repo: " + root + ".\n";
p_mech += "Run: bun " + root + "/apps/docs/scripts/check-doc-claims.ts\n";
p_mech += "Paste the command output. ok=true only if exit code 0.\n";
p_mech += "If the script is missing, ok=false and put that in failures.\n";
p_mech += "Do not edit files. Return {ok, exit_code, failures, summary}.\n";

let mechanical = agent(p_mech, #{
    label: "mechanical:claims",
    capability_mode: "execute",
    output_schema: mechanical_schema,
});
log("Mechanical: " + safe_summary(mechanical));

// ─── Review ──────────────────────────────────────────────────────
phase("Review");
log("Parallel docs-vs-code critics");

let p_home = critic_rules(root, spec, prefix);
p_home += "SHARD home. MDX: " + docs + "/index.mdx, quickstart.mdx, contributing.mdx, guides/best-practices.mdx.\n";
p_home += "Code: packages/core/src/index.ts, packages/core/src/create-payment-client.ts, packages/core/src/types/operation-result.ts, packages/core/src/gateways/factories.ts, packages/core/package.json, docs/getting-started.md (only as prior source, code still wins).\n";
p_home += "Check createPaymentClient / moyasarGateway / money / isPaidOutcome signatures and that samples would typecheck.\n";

let p_guides = critic_rules(root, spec, prefix);
p_guides += "SHARD guides. MDX under " + docs + "/guides/ except best-practices.mdx.\n";
p_guides += "Code: packages/core (money.ts, operation-result.ts, webhooks, runtime), packages/webhooks/src, packages/reconciliation/src, packages/routing/src, packages/store-postgres/src and /pg export, docs/adapter-capability-matrix.json vs each *STORAGE_ADAPTER_MANIFEST, docs/migrations/1.0.md vs 1.0-contracts.\n";
p_guides += "Check getting-started composition: createPostgresStoresFromPg, migratePostgresAdapter, processWebhookHttp, createWebhookInboxEngine actually exported from the named packages.\n";

let p_core = critic_rules(root, spec, prefix);
p_core += "SHARD core+built-in gateways. MDX: " + docs + "/packages/index.mdx, packages/core.mdx, gateways/index.mdx, moyasar.mdx, paypal.mdx, paymob.mdx, stripe.mdx, custom.mdx.\n";
p_core += "Code: packages/core/src/index.ts, packages/core/docs/baseline/public-api.inventory.json, packages/core/src/gateways/{moyasar,paypal,paymob,stripe}/*.ts, factories.ts, plugin registry. Tap/MyFatoorah must NOT be BuiltInGatewayName.\n";

let p_eng = critic_rules(root, spec, prefix);
p_eng += "SHARD engines. MDX: " + docs + "/packages/webhooks.mdx, reconciliation.mdx, routing.mdx, opentelemetry.mdx.\n";
p_eng += "Code: packages/webhooks/src/index.ts, packages/reconciliation/src/index.ts, packages/routing/src/index.ts, packages/observability/src/index.ts and package.json name @paykernel/opentelemetry plus ./otel subpath.\n";

let p_gw = critic_rules(root, spec, prefix);
p_gw += "SHARD extra-gateways. MDX: " + docs + "/gateways/tap.mdx, myfatoorah.mdx.\n";
p_gw += "Code: packages/gateway-tap/src/index.ts and gateway/factory, packages/gateway-myfatoorah/src/index.ts. Confirm exported factory names (tapGateway etc.) match docs. Confirm capture/void/refund/idempotency/status mapping vs implementation, not vs TAP/MyFatoorah marketing docs.\n";

let p_st = critic_rules(root, spec, prefix);
p_st += "SHARD stores. MDX under " + docs + "/stores/ plus packages/store-contracts.mdx and packages/sql-foundation.mdx.\n";
p_st += "Code: each packages/store-*/package.json exports, src/index.ts, manifest constants. Subpaths only as published: postgres /bun-sql /postgres-js /pg /drizzle; redis /bun /upstash /ioredis /node-redis; sqlite /bun /node /better-sqlite3; turso /serverless /libsql and NO /sync; d1 and durable-objects root only.\n";

let p_int = critic_rules(root, spec, prefix);
p_int += "SHARD integrations. MDX under " + docs + "/integrations/.\n";
p_int += "Code: packages/integration-http/src/index.ts (mapInboxOutcome, processWebhookHttp), integration-hono, elysia, express, cloudflare-workers src/index.ts. Raw-body requirement must match handlers.\n";

let p_ex = critic_rules(root, spec, prefix);
p_ex += "SHARD examples. MDX under " + docs + "/examples/.\n";
p_ex += "Code: examples/README.md and examples/*/src (checkout-kernel public helpers, host routes). enableTestHooks must not be documented as production. Private packages must not be described as published.\n";

let p_ref = critic_rules(root, spec, prefix);
p_ref += "SHARD reference. MDX under " + docs + "/reference/.\n";
p_ref += "Code: packages/core/docs/baseline/public-api.inventory.json, packages/core/src/errors.ts, packages/core/src/index.ts, packages/*/package.json names/exports, packages/core/docs/gateway-capabilities.md vs generated capabilities. Every listed runtime export in core-api.mdx must appear in the inventory JSON.\n";

let critics = parallel([
    #{ prompt: p_home, label: "critic:home", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_guides, label: "critic:guides", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_core, label: "critic:core", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_eng, label: "critic:engines", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_gw, label: "critic:extra-gateways", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_st, label: "critic:stores", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_int, label: "critic:integrations", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_ex, label: "critic:examples", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_ref, label: "critic:reference", capability_mode: "read-only", output_schema: findings_schema },
]);

let findings = [];
let dropped = 0;
if critics != () {
    for r in critics {
        if r != () && r.success && r.output != () && r.output.findings != () {
            for f in r.output.findings {
                if f != () && path_ok(f.file, prefix) && type_of(f.issue) == "string" && f.issue != "" {
                    findings.push(f);
                } else {
                    dropped += 1;
                }
            }
        }
    }
}
if dropped > 0 {
    log("dropped " + dropped.to_string() + " out-of-scope or empty findings");
}

const MAX_VERIFY = 32;
let to_verify = [];
let i = 0;
while i < findings.len() {
    if to_verify.len() < MAX_VERIFY {
        to_verify.push(findings[i]);
    }
    i += 1;
}
if findings.len() > MAX_VERIFY {
    log("capped verify at " + MAX_VERIFY.to_string() + " of " + findings.len().to_string() + " findings");
}
log(to_verify.len().to_string() + " in-scope findings after path filter");

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");

let confirmed = [];
if to_verify.len() == 0 {
    log("No review findings to verify");
} else {
    let vjobs = [];
    for f in to_verify {
        let vp = "";
        vp += "Adversarially verify this alleged docs-vs-code CONFLICT. Repo: " + root + ".\n";
        vp += "READ the MDX file and the implementation yourself with read_file/grep. Do not trust the critic. Do not edit.\n";
        vp += "Finding JSON: " + json_encode(f) + "\n";
        vp += "Set real=true ONLY if you independently confirmed: (1) the docs make claim X, (2) the code does Y, (3) X and Y disagree, (4) evidence includes source file:line.\n";
        vp += "Default real=false. If the critic misread the docs, the code matches, or the symbol exists under a different but documented export, real=false.\n";
        vp += "Intended honesty (NOT conflicts): packages are 0.1.0-next.0 unpublished 1.0; Redis optional; sqlite single-host; memory NON-PRODUCTION; no turso /sync; D1 != DO; never fulfill in onWebhookVerified; never createPayment after indeterminate.\n";
        vp += "Return {real, reason, evidence}. evidence must be non-empty for real=true.\n";
        vjobs.push(#{
            prompt: vp,
            label: "verify:docs",
            capability_mode: "read-only",
            output_schema: verdict_schema,
        });
    }
    let verdicts = parallel(vjobs);
    let vi = 0;
    if verdicts != () {
        while vi < verdicts.len() {
            let v = verdicts[vi];
            if v != () && v.success && v.output != () && v.output.real == true
                && v.output.evidence != () && v.output.evidence != "" {
                confirmed.push(to_verify[vi]);
            }
            vi += 1;
        }
    }
    log(confirmed.len().to_string() + "/" + to_verify.len().to_string() + " survived verification");
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");

let report = "";
report += "# PayKernel docs vs code critic\n\n";
report += "Mechanical: " + safe_summary(mechanical) + "\n";
report += "Review findings in-scope: " + findings.len().to_string() + "\n";
report += "Verified: " + to_verify.len().to_string() + "\n";
report += "Confirmed conflicts: " + confirmed.len().to_string() + "\n\n";
if confirmed.len() == 0 {
    report += "No evidence-backed docs-vs-code conflicts survived adversarial verification.\n";
} else {
    report += "## Confirmed conflicts\n\n";
    let ci = 0;
    while ci < confirmed.len() {
        let cf = confirmed[ci];
        report += "- `" + cf.file + "`: " + cf.issue + "\n";
        ci += 1;
    }
}

let path = write_scratch_file("paykernel-docs-code-critic.md", report);

let p_rep = "";
p_rep += "READ-ONLY wrap-up. Repo: " + root + ". Do not edit.\n";
p_rep += "Draft report:\n" + report + "\n";
p_rep += "Confirmed count: " + confirmed.len().to_string() + ".\n";
p_rep += "ok=true if the mechanical checker passed OR you note it failed in summary. Return {ok, summary, confirmed_count}.\n";

let reporter = agent(p_rep, #{
    label: "report:docs-critic",
    capability_mode: "read-only",
    output_schema: report_schema,
});
log("Report: " + safe_summary(reporter));

complete(#{
    ok: confirmed.len() == 0,
    path: path,
    confirmed_count: confirmed.len(),
    reviewed: findings.len(),
    mechanical: safe_summary(mechanical),
    summary: if reporter != () && reporter.success && reporter.output != () && reporter.output.summary != () {
        reporter.output.summary
    } else {
        report
    },
});
