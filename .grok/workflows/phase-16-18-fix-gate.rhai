let meta = #{
    name: "phase-16-18-fix-gate",
    description: "Critic, fix, verify, and adversarially gate Phase 16-18 review findings",
    phases: [
        #{ title: "Critic", detail: "confirm each Phase 16-18 finding still present" },
        #{ title: "Fix", detail: "three non-overlapping implementation streams" },
        #{ title: "Verify", detail: "typecheck plus d1 do testkit honesty tests" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "write gate report" },
    ],
    when_to_use: "After a Phase 16-18 (store-d1 + store-durable-objects + adapter-selection) review; fix Worker RPC/errors, D1 TX/compat, honesty tree, then gate",
};

let critic_schema = #{
    "type": "object",
    "required": ["confirmed", "already_fixed", "summary"],
    "properties": #{
        "confirmed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "already_fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "fixed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 24 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["ok", "typecheck_ok", "tests_ok", "failures", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 20 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 30 },
        "summary": #{ "type": "string" },
    },
};

let rem_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 24 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 24 },
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

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Confirming Phase 16-18 findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "P16-TX: store-d1 createD1Executor always attaches transaction() using BEGIN IMMEDIATE/COMMIT. Live D1 does not support interactive BEGIN. withTransaction only throws StoreUnsupportedFeatureError when transaction is missing — so the primary binding API hits BEGIN then mapDriverError -> retryable StoreUnavailableError. Evidence: packages/store-d1/src/executor.ts transaction = BEGIN IMMEDIATE; packages/store-d1/src/stores/shared.ts if typeof outer.transaction !== function throw. Manifest still says no local sync BEGIN IMMEDIATE.\n";
p_c += "P16-ALS: packages/store-d1/src/stores/shared.ts static import AsyncLocalStorage from node:async_hooks. examples/wrangler.toml and smoke/wrangler.toml use compatibility_date 2024-09-23 with no nodejs_compat / nodejs_als. CF docs require a flag unless date is 2026-08-04+.\n";
p_c += "P16-SUCCESS: createD1Executor query() returns result.results ?? [] without checking success/error. batch() discards statement results. A failed UPSERT that resolves empty looks like a claim miss.\n";
p_c += "P16-SESSION: createD1PaymentStores defaults first-primary when withSession exists. createD1Executor / createD1Stores / migrateD1Adapter do not. README executor path can skip sessions under replication.\n";
p_c += "P17-RPC: createDoPaymentStores hash path always RPCs bindHashPartitionLayout (client.ts ensureDoHashPartitionLayout). PaymentsStoreObject implements it. smoke/worker.ts PaymentsStoreDurableObject and examples/wrangler.toml sketch do NOT forward bindHashPartitionLayout. Mock namespace Proxy forwards any method so tests pass. Live hash reserve fails.\n";
p_c += "P17-ERR: Worker client wraps every stub call in withMappedErrors. instanceof StoreError is lost across CF RPC (only Error name/message survive). mapDriverError reconstructs StoreLeaseLostError only if err.code === lease_lost, not err.name. Default is retryable StoreUnavailableError. Stale complete after reclaim looks transient.\n";
p_c += "P17-CLEAN: fanOutDeleteExpired with limit walks hash partitions 0..N-1 and stops when remaining==0. Partition 0 with >=limit rows starves later partitions.\n";
p_c += "P17-NS: DoClientStoreOptions.tableNamespace comment says applied inside each DO. createDoPaymentStores only uses it for returned metadata. PaymentsStoreObject resolves tables from its own constructor options. Worker client does not pass prefix on RPC.\n";
p_c += "P17-TENANT: client shard() accepts tenantId but every call is shard(input.key). Dynamic tenantId function only sees {key}. partitions.do.test.ts tenant isolation uses TWO mock namespaces so a broken router still passes.\n";
p_c += "P17-CURSOR: bindHashPartitionLayout CREATE/INSERT sql.exec without toArray() before the next exec. Alarm schema does consume. CF DO requires cursor consume before next I/O.\n";
p_c += "P18-TREE: docs/adapter-selection.md mermaid/Q&A after not-already-on-D1 and not-need-per-key asks Bun/Node local file. A Workers/Bun app can be sent to store-sqlite. No Workers/ephemeral-FS refuse. Q2 Yes never asks per-key so existing D1 never reaches DO. Greenfield Workers who refuse local file get Turso before D1.\n";
p_c += "P18-LIBSQL: turso-libsql frozen row distributed yes / multi-host while /libsql accepts local file. Honesty test copies TURSO_STORAGE_ADAPTER_MANIFEST onto both rows.\n";
p_c += "P18-STALE: adapter-capability-matrix.json / adapter-selection-matrix.ts turso-serverless limitation still says adapter-sqlite. store-d1/docs and store-durable-objects/docs comparison tables still say adapter-cloudflare-d1 / adapter-cloudflare-do.\n";
p_c += "Return confirmed[] as ID strings, already_fixed[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:phase-16-18",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Three non-overlapping Phase 16-18 fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style. Do not weaken tests. Prefer fail-closed money/lease status.\n";

let p_a = rules;
p_a += "STREAM A D1. Files ONLY under packages/store-d1/ (src, docs, examples, smoke wrangler). Do not edit store-durable-objects or docs/adapter-selection.md.\n";
p_a += "FIX P16-TX: Do not attach executor.transaction that issues BEGIN IMMEDIATE on a live D1 binding. Fail closed with StoreUnsupportedFeatureError (same message style as shared.ts) unless you can prove the target is mock/same-connection SQLite. Preferred: omit transaction() on createD1Executor for real bindings; keep BEGIN IMMEDIATE only inside test-utils/mock-d1.ts if tests need it. Store withTransaction must throw StoreUnsupportedFeatureError on production D1, not StoreUnavailableError after a rejected BEGIN. Update stores.unit.test.ts / errors tests. Manifest note must match (no live BEGIN IMMEDIATE).\n";
p_a += "FIX P16-ALS: Either (1) add compatibility_flags = [nodejs_compat] (or nodejs_als) to examples/wrangler.toml, smoke/wrangler.toml, docs/wrangler.md, README deploy notes; bump compatibility_date comment; OR (2) drop the node:async_hooks import if withTransaction no longer needs ALS on D1. Document the requirement if ALS stays. A Worker copying examples/wrangler.toml must not fail on node:async_hooks.\n";
p_a += "FIX P16-SUCCESS: query() must throw when D1 result.success === false or error is set (do not treat as empty miss). batch() must inspect per-statement success or rely on throw and assert that in a test. Add a unit/mock test: success:false all() does not become acquired/in_progress miss.\n";
p_a += "FIX P16-SESSION: createD1Executor(db) must default session to first-primary when db.withSession exists, matching createD1PaymentStores. Explicit session: false or omit withSession stays unbound. migrateD1Adapter wrapping a raw binding should use the same default. Update sessions.d1.test.ts.\n";
p_a += "FIX P18-STALE for store-d1 docs only: replace adapter-cloudflare-d1 / adapter-cloudflare-do / adapter-sqlite / adapter-turso comparison labels with @paykernel/store-* names. Fix overview sessions-as-optional wording to match default first-primary. sql-foundation not internal/sql-store if mentioned in store-d1 docs.\n";
p_a += "Do not invent multi-region. Do not auto-migrate on import.\n";

let p_b = rules;
p_b += "STREAM B DO. Files ONLY under packages/store-durable-objects/ (src, docs, examples, smoke). Do not edit store-d1 or docs/adapter-selection.md.\n";
p_b += "FIX P17-RPC: Forward bindHashPartitionLayout on smoke/worker.ts PaymentsStoreDurableObject (await ready() then inner.bindHashPartitionLayout). Add the same method to examples/wrangler.toml sketch and docs/wrangler.md / README as a required RPC for hash sharding. Prefer a small documented required-RPC list so the next DO-1 method is not omitted. Add a test: a thin wrapper object that only has reserveIdempotency (not bindHashPartitionLayout) fails hash createDoPaymentStores reserve via callStub/TypeError or explicit missing-method. Mock namespace may keep Proxy, but add a dedicated thin-wrapper test that does not use the Proxy.\n";
p_b += "FIX P17-ERR: Reconstruct StoreError after RPC before mapDriverError. Match err.name (StoreLeaseLostError, StoreUnsupportedFeatureError, StoreInvalidSchemaError, …) and/or a serializable envelope { __pkStoreError, code }. StoreLeaseLostError must remain instanceof StoreLeaseLostError on the Worker after a stub hop that clones Error like CF (name+message only, no prototype). Add a test: cloned Error { name: StoreLeaseLostError, message: ... } through withMappedErrors is StoreLeaseLostError not StoreUnavailableError. Do not treat lease_lost as retryable unavailable.\n";
p_b += "FIX P17-CLEAN: Bounded deleteExpired must not starve later hash partitions. Round-robin / rotate start / pull a slice from every partition then pick globally oldest, or walk all partitions with a per-partition budget. Add a test with two partitions where partition 0 has more than limit eligible rows and partition 1 also has eligible rows — both must lose some rows over repeated limited deletes, or a single limited delete must not exclusively drain only index 0 forever.\n";
p_b += "FIX P17-NS: Either pass tableNamespace on every RPC and apply it inside PaymentsStoreObject, or stop claiming it is applied inside each DO (types.ts + README + docs). Prefer passing it (constructor already accepts namespace). Tests must not rely on mock auto-injecting a prefix the Worker client never sent.\n";
p_b += "FIX P17-TENANT: Stop advertising unused shard(key, tenantId) if store contracts have no tenantId. Document: Worker tenant strategy is static tenantId string, or a function of key only. partitions.do.test.ts must use ONE namespace and two tenant strategies; assert distinct shard names tenant:acme vs tenant:globex and isolation of the same key.\n";
p_b += "FIX P17-CURSOR: bindHashPartitionLayout must .toArray() every sql.exec (CREATE, SELECT, INSERT) before the next statement or return. Prefer transactionSync for the seal write.\n";
p_b += "DOCS in this package: never global DO; hash partitions=1 is a single partition (warn); replace adapter-cloudflare-* labels with store-* names; alarms remain optional (do not wire failWebhook to alarms unless already almost done — document pull-only recovery).\n";
p_b += "Do not add kind global. Do not auto-migrate on import.\n";

let p_d = rules;
p_d += "STREAM C PHASE 18 HONESTY. Files ONLY:\n";
p_d += "docs/adapter-selection.md\n";
p_d += "docs/adapter-capability-matrix.json\n";
p_d += "packages/testkit/src/storage/adapter-selection-matrix.ts\n";
p_d += "packages/testkit/src/storage/adapter-selection-matrix.test.ts\n";
p_d += "scripts/check-adapter-selection-honesty.test.ts\n";
p_d += "Do not edit store-d1 or store-durable-objects production src (streams A/B own those).\n";
p_d += "FIX P18-TREE: Decision tree must refuse local SQLite for Cloudflare Workers / ephemeral serverless FS. After Q1 no-postgres: if on Workers, recommend D1 (shared relational) OR DO (per-key) — never store-sqlite. Existing D1 plus need per-key must still be able to reach DO (do not hide DO behind already-on-D1). Greenfield Workers without existing D1 should see D1 as Worker-native default, not jump to Turso. Fail-closed: multi-isolate + only local file => STOP. Update mermaid AND numbered Q&A to the same logic. Keep Redis optional. Keep never-global-DO.\n";
p_d += "FIX P18-LIBSQL: Machine-readable turso-libsql row must not claim flat distributed yes for a binding that also opens file:. Use an honest distributed cell or limitation that matches the human table (remote multi-host; local file is single-host testing only). Do not invent a second Turso manifest unless needed; prefer limitation + honesty test lock.\n";
p_d += "FIX P18-STALE in matrix/TS only: replace adapter-sqlite in turso-serverless importantLimitation with store-sqlite / @paykernel/store-sqlite.\n";
p_d += "Strengthen honesty tests so a wrong mermaid destination or a libSQL flat-yes lie fails: lock Workers-not-sqlite, D1-or-DO for Workers, and the libSQL limitation phrase. Keep live manifest enum checks.\n";
p_d += "Do not market memory as production. Do not add multi-region.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:d1", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:do", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:phase18", capability_mode: "all", output_schema: fix_schema },
]);

let fi = 0;
for f in fixes {
    log("Fix stream " + fi.to_string() + ": " + safe_summary(f));
    fi += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Typecheck and targeted Phase 16-18 tests");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root with command evidence (paste relevant fail lines):\n";
p_v += "1) bun run typecheck\n";
p_v += "2) bun test packages/store-d1 packages/store-durable-objects packages/testkit/src/storage/adapter-selection-matrix.test.ts scripts/check-adapter-selection-honesty.test.ts\n";
p_v += "Env-gated live D1/DO skips are OK. Failing unit tests are not OK.\n";
p_v += "3) Grep/read invariants (must hold):\n";
p_v += "   - store-d1 live executor does not advertise working BEGIN IMMEDIATE withTransaction (throws StoreUnsupportedFeatureError or has no transaction())\n";
p_v += "   - store-d1 wrangler examples mention nodejs_compat or nodejs_als OR ALS import is gone\n";
p_v += "   - query() does not swallow success:false as empty results\n";
p_v += "   - createD1Executor defaults first-primary when withSession exists\n";
p_v += "   - smoke/worker.ts and examples/wrangler.toml expose bindHashPartitionLayout\n";
p_v += "   - withMappedErrors reconstructs StoreLeaseLostError from name after clone\n";
p_v += "   - adapter-selection.md does not send Workers apps to store-sqlite\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass.\n";

let verify = agent(p_v, #{
    label: "verify:tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Phase 16-18 blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence.\n";
p_g += "BLOCKERS:\n";
p_g += "P17-RPC: Official smoke DO class AND wrangler example forward bindHashPartitionLayout. Hash createDoPaymentStores can call it.\n";
p_g += "P17-ERR: Cloned Error named StoreLeaseLostError is reconstructed as StoreLeaseLostError (not StoreUnavailableError) on the Worker client path.\n";
p_g += "P16-TX: Production D1 withTransaction is fail-closed StoreUnsupportedFeatureError (or no transaction() attached). No live binding BEGIN IMMEDIATE path that maps to retryable unavailable.\n";
p_g += "P16-ALS: Example/smoke wrangler enable nodejs_compat/nodejs_als or ALS import removed.\n";
p_g += "P16-SUCCESS: query() throws on success:false.\n";
p_g += "P16-SESSION: createD1Executor defaults first-primary when withSession exists.\n";
p_g += "P17-CLEAN: limited deleteExpired does not exclusively starve later hash partitions.\n";
p_g += "P17-TENANT: tenant isolation test uses one namespace; unused tenantId footgun documented or removed.\n";
p_g += "P17-CURSOR: bindHashPartitionLayout consumes every sql.exec cursor.\n";
p_g += "P18-TREE: Workers/ephemeral FS cannot be recommended store-sqlite; existing D1 can still reach DO for per-key; greenfield Workers see D1.\n";
p_g += "P18-LIBSQL: frozen libSQL row does not flat-overclaim multi-host for file: clients.\n";
p_g += "Non-blocking: leftover adapter-* labels in historical gate reports; optional alarms not auto-wired to failWebhook.\n";
p_g += "Return {pass, blocking, non_blocking, summary}.\n";

let gate = agent(p_g, #{
    label: "gate:adversarial",
    capability_mode: "read-only",
    output_schema: gate_schema,
});
log("Gate: " + safe_summary(gate));

let gate_pass = false;
if gate != () && gate.success && gate.output != () && gate.output.pass == true {
    gate_pass = true;
}

// ─── Remediate ───────────────────────────────────────────────────
phase("Remediate");
if gate_pass {
    log("Gate passed; skipping remediate");
} else {
    log("Gate failed; remediating remaining blockers");
    let blockers = "";
    if gate != () && gate.success && gate.output != () && gate.output.blocking != () {
        for b in gate.output.blocking {
            blockers += b + "\n";
        }
    } else {
        blockers += "Gate missing or failed closed. Re-read P16-TX P16-ALS P16-SUCCESS P16-SESSION P17-RPC P17-ERR P17-CLEAN P17-TENANT P17-CURSOR P18-TREE P18-LIBSQL and fix any still present.\n";
    }

    let p_r = rules;
    p_r += "REMEDIATE remaining Phase 16-18 blockers. You may edit packages/store-d1, packages/store-durable-objects, docs/adapter-selection.md, docs/adapter-capability-matrix.json, packages/testkit/src/storage/adapter-selection-matrix.ts, packages/testkit/src/storage/adapter-selection-matrix.test.ts, scripts/check-adapter-selection-honesty.test.ts.\n";
    p_r += "Blockers:\n";
    p_r += blockers;
    p_r += "Fix them with tests. Do not commit. Then run bun test on the touched packages.\n";
    p_r += "Return {ok, fixed, remaining, summary}.\n";

    let rem = agent(p_r, #{
        label: "remediate:blockers",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    log("Remediate: " + safe_summary(rem));
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
log("Writing Phase 16-18 fix-gate report");

let p_rep = "";
p_rep += "Write a gate report to " + root + "/packages/core/docs/baseline/phase-16-18-fix-gate-report.md\n";
p_rep += "and a short pointer at " + root + "/docs/phase-16-18-fix-gate-report.md if that convention exists for other phases.\n";
p_rep += "Repo: " + root + "\n";
p_rep += "Use read_file/grep plus the critic/fix/verify/gate outcomes. Be honest. Do not claim PASS without file:line evidence that blockers are gone.\n";
p_rep += "Include: verdict, per-ID table (P16-TX P16-ALS P16-SUCCESS P16-SESSION P17-RPC P17-ERR P17-CLEAN P17-NS P17-TENANT P17-CURSOR P18-TREE P18-LIBSQL P18-STALE), tests/typecheck commands, remaining nits.\n";
p_rep += "Match the style of packages/core/docs/baseline/phase-18-gate-report.md (shorter is OK).\n";
p_rep += "Return {ok, report_path, summary}.\n";

let report = agent(p_rep, #{
    label: "report:gate",
    capability_mode: "all",
    output_schema: report_schema,
});
log("Report: " + safe_summary(report));

let report_path = "";
if report != () && report.success && report.output != () && report.output.report_path != () {
    report_path = report.output.report_path;
}

complete(#{
    summary: "Phase 16-18 critic/fix/verify/gate finished. Gate pass=" + gate_pass.to_string() + ". " + safe_summary(report),
    gate_pass: gate_pass,
    report_path: report_path,
    critic: safe_summary(critic),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
});
