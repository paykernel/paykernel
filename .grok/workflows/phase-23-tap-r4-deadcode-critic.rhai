let meta = #{
    name: "phase-23-tap-r4-deadcode-critic",
    description: "Read-only critic of committed gateway-tap HEAD for remaining logic bugs and dead code after r2 merge",
    phases: [
        #{ title: "Critic", detail: "mistakes, logic, dead code on packages/gateway-tap/src" },
        #{ title: "Gate", detail: "adversarial fail-closed" },
    ],
    when_to_use: "After Tap r2 is on main; check remaining mistakes and dead code before considering the review closed",
};

let critic_schema = #{
    "type": "object",
    "required": ["blocking", "dead_code", "non_blocking", "summary"],
    "properties": #{
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "dead_code": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
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

phase("Critic");
log("Criticizing committed gateway-tap at " + root);

let p = "";
p += "READ-ONLY. Repo: " + root + "\n";
p += "Use read_file and grep on packages/gateway-tap/src ONLY. Do not edit. Do not answer from memory.\n";
p += "Look for mistakes, logical problems, unused imports, unused types, unused params, unreachable branches, wrong Tap status models.\n";
p += "Known intended behavior (do not flag as bugs):\n";
p += "- Capture AUTHORIZED or CAPTURED; VOID rejected.\n";
p += "- Refund ACCEPTED is pending.\n";
p += "- lastName required on inline customers; blank rejected.\n";
p += "- Capture redirect.url from tapRedirectUrl or authorize.redirect.url.\n";
p += "- HTTP mapper does not treat 50x error codes as CardDeclinedError.\n";
p += "- mapTapChargeOutcome has no redirectUrl param.\n";
p += "- TapChargeStatus and TapRefundStatus unions were removed as unused.\n";
p += "Blocking = correctness/money bugs. dead_code = unused symbols still in src. Empty arrays OK only after reading gateway.ts status.ts http.ts types.ts config.ts sources.ts webhooks.ts money.ts.\n";
p += "Return {blocking, dead_code, non_blocking, summary}.\n";

let critic = agent(p, #{
    label: "critic:tap-r4",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

phase("Gate");
let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Re-read packages/gateway-tap/src. pass=true only if blocking[] from an independent read is empty: no unused TapChargeStatus/TapRefundStatus types, no unused mapTapChargeOutcome redirectUrl, VOID not capturable, ACCEPTED pending, lastName required, capture sends redirect.url.\n";
p_g += "Critic summary: " + safe_summary(critic) + "\n";
p_g += "Return {pass, blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:tap-r4",
    capability_mode: "read-only",
    output_schema: gate_schema,
});
log("Gate: " + safe_summary(gate));

let pass = false;
if gate != () && gate.success && gate.output != () && gate.output.pass == true {
    pass = true;
}

complete(#{
    summary: "Tap r4 deadcode critic. pass=" + pass.to_string() + " critic=" + safe_summary(critic) + " gate=" + safe_summary(gate),
    pass: pass,
});
