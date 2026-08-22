let meta = #{
    name: "phase-23-tap-r3-diff-critic",
    description: "Read-only critic of the gateway-tap review diff for logic bugs, dead code, and leftover TAP-LAST-NAME / TAP-CAPTURE-REDIRECT",
    phases: [
        #{ title: "Critic", detail: "logic, dead code, open-point closure" },
        #{ title: "Gate", detail: "adversarial fail-closed pass" },
    ],
    when_to_use: "After Tap r2+open-point fixes; check the uncommitted gateway-tap diff before merge",
};

let critic_schema = #{
    "type": "object",
    "required": ["blocking", "non_blocking", "dead_code", "summary"],
    "properties": #{
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "dead_code": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
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
log("Criticizing gateway-tap diff in " + root);

let p = "";
p += "READ-ONLY. Repo: " + root + "\n";
p += "Use read_file and grep on packages/gateway-tap/src. Do not edit. Do not answer from memory.\n";
p += "Inspect current code (not HEAD) for mistakes, logical problems, dead code, unused imports, unused params, unreachable branches.\n";
p += "MUST confirm these are CLOSED with file:line:\n";
p += "TAP-LAST-NAME: inline tapCustomer lastName is required in types.ts AND serializeCustomer rejects blank lastName. Tests exist.\n";
p += "TAP-CAPTURE-REDIRECT: capture POST includes redirect.url from tapRedirectUrl or authorize.redirect.url; missing both throws before POST. Tests exist.\n";
p += "TAP-CAPTURE-STATUS: VOID throws; CAPTURED replays POST /charges.\n";
p += "TAP-REFUND-ACCEPTED: ACCEPTED is pending.\n";
p += "mapTapChargeOutcome must NOT have an unused redirectUrl parameter.\n";
p += "Put real bugs in blocking[]. Dead unused symbols in dead_code[]. Style in non_blocking[].\n";
p += "Empty arrays are valid only after reading gateway.ts, status.ts, http.ts, types.ts, config.ts, and the matching tests.\n";
p += "Return {blocking, non_blocking, dead_code, summary}.\n";

let critic = agent(p, #{
    label: "critic:tap-r3-diff",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

phase("Gate");
let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. pass=true only if TAP-LAST-NAME and TAP-CAPTURE-REDIRECT are closed with tests, VOID is not capturable, ACCEPTED is pending, and there is no unused mapTapChargeOutcome redirectUrl param.\n";
p_g += "Critic said: " + safe_summary(critic) + "\n";
p_g += "Do not trust the critic. Re-read the files. Return {pass, blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:tap-r3-diff",
    capability_mode: "read-only",
    output_schema: gate_schema,
});
log("Gate: " + safe_summary(gate));

let pass = false;
if gate != () && gate.success && gate.output != () && gate.output.pass == true {
    pass = true;
}

complete(#{
    summary: "Tap r3 diff critic. pass=" + pass.to_string() + " critic=" + safe_summary(critic) + " gate=" + safe_summary(gate),
    pass: pass,
});
