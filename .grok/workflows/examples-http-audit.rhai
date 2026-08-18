let meta = #{
    name: "examples-http-audit",
    description: "Read-only audit of Hono/Elysia checkout examples for mistakes, logic bugs, and dead code",
    phases: [
        #{ title: "Audit", detail: "three parallel critics: logic, dead code, mistakes" },
        #{ title: "Synthesize", detail: "dedupe findings and rank severity" },
    ],
    when_to_use: "After examples/ Hono+Elysia checkout work; hunt logic bugs, dead code, and mistakes before merge",
};

let findings_schema = #{
    "type": "object",
    "required": ["findings", "summary"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 16,
            "items": #{
                "type": "object",
                "required": ["id", "severity", "file", "issue"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                },
            },
        },
        "summary": #{ "type": "string" },
    },
};

let synth_schema = #{
    "type": "object",
    "required": ["blocking", "should_fix", "nits", "summary"],
    "properties": #{
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "should_fix": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "nits": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
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

phase("Audit");
log("Auditing examples/ in " + root);

let base = "";
base += "READ-ONLY. Repo: " + root + ".\n";
base += "Use read_file and grep. Do not edit. Do not answer from memory. Every finding needs file:line evidence.\n";
base += "Scope ONLY: examples/** and the small root/docs wiring that landed with it. Ignore packages/* unless examples misuse a public API.\n";
base += "Return at most 16 findings as {id, severity, file, issue}. severity is blocking | should_fix | nit.\n";
base += "Empty findings is valid only after you have read the files.\n";

let p_logic = base;
p_logic += "LENS: logical problems. Read examples/checkout-kernel/src/kernel.ts, handlers.ts, http-policy.ts, stripe-webhook.ts, scenarios.ts and both app.ts files.\n";
p_logic += "Look for: fulfill without claim; silent ACK of failed work; wrong HTTP map vs docs/getting-started.md; reconcile completing without decideReconciliationPolicy; second createPayment after indeterminate; parse-then-stringify Stripe body accepted; InvalidRequestError after verify mapped as 400 forgery; paid webhook not locating the order; fulfillCount vs status inconsistency; update_local_to_failed completing without local change; hash mixing raw string vs object.\n";

let p_dead = base;
p_dead += "LENS: dead code / unused exports / unused fields. Grep every export from examples/checkout-kernel/src/index.ts and kernel CheckoutKernel fields (mock, stripeWebhookSecret). Flag unused imports, unreachable branches, speculative options with no caller, duplicated asCreateInput/readJson in three files.\n";

let p_mistakes = base;
p_mistakes += "LENS: mistakes / API misuse. Confirm createPaymentClient gateways map, mock adapter wrap, stripeGateway webhookSecret, createBunSqliteStoresInMemory + migrateSqliteAdapter, handleWebhook('stripe', raw, sig), resolveInboxPayloadHash, processVerified, scheduler.processDue, money() not number majors. Flag hallucinated APIs, wrong option names, exactOptionalPropertyTypes hazards (passing undefined).\n";

let audits = parallel([
    #{ prompt: p_logic, label: "audit:logic", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_dead, label: "audit:dead-code", capability_mode: "read-only", output_schema: findings_schema },
    #{ prompt: p_mistakes, label: "audit:mistakes", capability_mode: "read-only", output_schema: findings_schema },
]);

let all = [];
let i = 0;
for a in audits {
    log("Audit " + i.to_string() + ": " + safe_summary(a));
    if a != () && a.success && a.output != () && a.output.findings != () {
        for f in a.output.findings {
            all.push(f);
        }
    }
    i += 1;
}

phase("Synthesize");
let p_s = "";
p_s += "READ-ONLY synthesize. Repo: " + root + ".\n";
p_s += "You received untrusted critic findings. Re-read the cited files and keep only findings you independently confirm.\n";
p_s += "Drop duplicates and anything without file:line evidence.\n";
p_s += "Findings JSON:\n" + json_encode(all) + "\n";
p_s += "Return {blocking, should_fix, nits, summary} as short ID: file:line — issue strings.\n";

let synth = agent(p_s, #{
    label: "audit:synthesize",
    capability_mode: "read-only",
    output_schema: synth_schema,
});
log("Synthesize: " + safe_summary(synth));

let blocking = [];
let should_fix = [];
let nits = [];
if synth != () && synth.success && synth.output != () {
    if synth.output.blocking != () { blocking = synth.output.blocking; }
    if synth.output.should_fix != () { should_fix = synth.output.should_fix; }
    if synth.output.nits != () { nits = synth.output.nits; }
}

complete(#{
    blocking: blocking,
    should_fix: should_fix,
    nits: nits,
    summary: safe_summary(synth),
    critic_count: all.len(),
});
