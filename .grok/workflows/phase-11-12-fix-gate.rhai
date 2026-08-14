let meta = #{
    name: "phase-11-12-fix-gate",
    description: "Critic, fix, verify, and adversarially gate Phase 11-12 review findings",
    phases: [
        #{ title: "Critic", detail: "confirm each Phase 11-12 finding still present" },
        #{ title: "Fix", detail: "four non-overlapping implementation streams" },
        #{ title: "Verify", detail: "typecheck plus foundation and adapter tests" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "write gate report" },
    ],
    when_to_use: "After a Phase 11-12 (sql-foundation + store-postgres) review; fix classification, migrate, tenant honesty, then gate",
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
log("Confirming Phase 11-12 findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "P11-IDEM-1: Postgres/sqlite/turso/d1/do idempotency reserve miss classifies fingerprint_conflict BEFORE completed/indeterminate. Contract + decideIdempotencyReserve require terminal first. Evidence: store-postgres/src/stores/idempotency-store.ts miss path after empty ON CONFLICT RETURNING.\n";
p_c += "P11-REF-1: sql-foundation memory-relational failWebhook uses decideLeaseMutation without requireActiveLease:false so WEBHOOKS-2 fail-after-expiry is rejected. markIdempotencyIndeterminate already passes false.\n";
p_c += "P11-IDEM-2: No classifyIdempotencyReserveMiss + no timestamp canonicalize/retry on idempotency (webhook/recon have STORES-4/SQL-1). Miss of reserved+expired-by-Date.parse but lexical TEXT miss becomes in_progress forever.\n";
p_c += "P11-TENANT-1: tenantColumn is validated and DDL has tenant_id, but stores never write/filter tenant_id; custom tenant column name never applied to DDL; no unique (tenant_id, key). Enabling tenantColumn is a no-op for isolation.\n";
p_c += "P11-SCHEMA-1: migrate() interpolates sqlSchema into CREATE TABLE but never CREATE SCHEMA IF NOT EXISTS. Missing schema fails first DDL.\n";
p_c += "P11-MIG-1: migrate version INSERT has no ON CONFLICT / OR IGNORE. Concurrent migrators can PK-fail after successful IF NOT EXISTS DDL. MIGRATE_HAS_PORTABLE_LOCK is false (honest) but ledger insert is not idempotent.\n";
p_c += "P11-DEL-1: deleteExpired binds input.before raw (not canonicalizeIsoTimestamp) on postgres idempotency/webhook/recon. Offset-form before vs TEXT Z updated_at under/over deletes.\n";
p_c += "P11-DOC-1: sql-foundation docs/atomic-claims.md says production fail templates require unexpired lease. webhookFailTemplates do not (WEBHOOKS-2).\n";
p_c += "P11-DOC-2: sql-foundation src/index.ts still says NOT a public npm product; package is published as @paykernel/sql-foundation.\n";
p_c += "P11-DOC-3: tenant docs imply optional tenant isolation; listDue comment says non-mutating scan while it UPDATEs; drizzle 12.3 promised schema exports that do not exist; expired/failed statuses never written by postgres; webhook gateway/first_received_at never written.\n";
p_c += "Return confirmed[] as ID strings, already_fixed[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:phase-11-12",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Four non-overlapping Phase 11-12 fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style. Do not weaken tests. Prefer fail-closed classification and explicit migrate.\n";

let p_a = rules;
p_a += "STREAM A FOUNDATION. Files ONLY under packages/sql-foundation/:\n";
p_a += "src/claims/algorithm.ts\n";
p_a += "src/claims/algorithm.test.ts\n";
p_a += "src/claims/templates.ts\n";
p_a += "src/index.ts\n";
p_a += "src/public-api.test.ts (only if you add exports)\n";
p_a += "src/reference/memory-relational-store.ts\n";
p_a += "src/migrations/migrate.ts\n";
p_a += "src/migrations/migrate.test.ts\n";
p_a += "docs/atomic-claims.md\n";
p_a += "FIX P11-IDEM-1/2 foundation: add classifyIdempotencyReserveMiss mirroring decideIdempotencyReserve order: completed, then indeterminate, then fingerprint mismatch, then reserved+active lease => in_progress, else claimable (expired/null lease or status expired). Export from index.ts. Tests: completed+other fingerprint => already_completed; indeterminate+other => indeterminate; reserved+other => fingerprint_conflict; reserved+expired lease => claimable.\n";
p_a += "FIX P11-IDEM-2 templates: add idempotencyTimestampRepairTemplates (same fence style as webhook/recon): canonicalize lease_expires_at only when status expired OR lease null/expired; never clobber an active reserved lease. Export from index.ts.\n";
p_a += "FIX P11-REF-1: failWebhook decideLeaseMutation must pass requireActiveLease: false (WEBHOOKS-2). Add a unit/reference test: claim, advance clock past lease, failWebhook with same token succeeds.\n";
p_a += "FIX P11-SCHEMA-1: in migrate(), if dialect postgres and ns.sqlSchema set, run CREATE SCHEMA IF NOT EXISTS with quoteIdentifier(sqlSchema) BEFORE ensureMigrationsTable / CREATE TABLE. Test statements include CREATE SCHEMA.\n";
p_a += "FIX P11-MIG-1: postgres version INSERT use ON CONFLICT (version) DO NOTHING; sqlite/generic use INSERT OR IGNORE. Test that a second insert of the same version does not throw when simulated. Keep MIGRATE_HAS_PORTABLE_LOCK false. Do not invent a portable advisory lock.\n";
p_a += "FIX P11-DOC-1: atomic-claims.md must say webhook fail succeeds after expiry with matching token; complete/renew still require active lease; recon fail still requires active lease per contract.\n";
p_a += "FIX P11-DOC-2: index.ts header must say publishable shared relational foundation, not a general ORM, not private-only.\n";
p_a += "Do not edit store-postgres or later adapters (streams B/C).\n";

let p_b = rules;
p_b += "STREAM B POSTGRES STORES. Files ONLY under packages/store-postgres/src/stores/ plus store unit tests:\n";
p_b += "src/stores/idempotency-store.ts\n";
p_b += "src/stores/webhook-inbox-store.ts\n";
p_b += "src/stores/reconciliation-store.ts\n";
p_b += "src/stores/stores.unit.test.ts\n";
p_b += "FIX P11-IDEM-1: after empty reserve RETURNING, classify with classifyIdempotencyReserveMiss (import from @paykernel/sql-foundation). Order MUST be completed / indeterminate before fingerprint_conflict. Tests: scripted executor empty INSERT + SELECT completed+other fingerprint => already_completed; indeterminate+other => indeterminate.\n";
p_b += "FIX P11-IDEM-2: if miss === claimable, canonicalize leaseExpiresAt (canonicalizeOptionalIsoTimestamp) + now, run idempotencyTimestampRepairTemplates.postgres, retry reserve SQL once. If still claimable, throw StoreUnavailableError (same pattern as webhook/recon). Test offset-form expired lease_expires_at repairs and acquires.\n";
p_b += "FIX P11-DEL-1: canonicalizeIsoTimestamp(input.before, before) on deleteExpired for all three stores before binding. Test that the bound param is Z form when input is offset.\n";
p_b += "Fix stale comment in reconciliation listDue that calls the scan non-mutating (it UPDATEs expired claimed first).\n";
p_b += "Do not implement full multi-tenant PK redesign here. Do not edit sql-foundation (stream A) or sqlite/turso/d1/do (stream C).\n";

let p_c = rules;
p_c += "STREAM C LATER SQL ADAPTERS (same inverted miss order). Files ONLY:\n";
p_c += "packages/store-sqlite/src/stores/idempotency-store.ts\n";
p_c += "packages/store-sqlite/src/stores/stores.unit.test.ts (add miss-order tests if file exists)\n";
p_c += "packages/store-turso/src/stores/idempotency-store.ts\n";
p_c += "packages/store-d1/src/stores/idempotency-store.ts\n";
p_c += "packages/store-durable-objects/src/stores/idempotency-store.ts\n";
p_c += "Plus matching *stores.unit.test.ts under those packages if they already exist — do not create huge new test files; add focused cases to existing unit tests.\n";
p_c += "FIX P11-IDEM-1 copies: invert miss classification to completed, then indeterminate, then fingerprint_conflict, then in_progress. Prefer classifyIdempotencyReserveMiss from @paykernel/sql-foundation if already exported; if not yet merged, write the same order inline and leave a comment that foundation helper is source of truth.\n";
p_c += "If the adapter already has a claimable/repair path for webhook, add the same one-shot canonicalize+retry for idempotency when miss is claimable (P11-IDEM-2). If no repair helper is imported yet, at least get classification order right.\n";
p_c += "Also canonicalize deleteExpired input.before in these adapters if they bind TEXT updated_at <= before (same P11-DEL-1).\n";
p_c += "Do not edit store-postgres or sql-foundation.\n";

let p_d = rules;
p_d += "STREAM D DOCS HONESTY. Files ONLY (docs/README, no production logic except comments already owned):\n";
p_d += "packages/sql-foundation/docs/relational-foundation.md\n";
p_d += "packages/sql-foundation/docs/migrations.md\n";
p_d += "packages/sql-foundation/README.md\n";
p_d += "packages/store-postgres/docs/overview.md\n";
p_d += "packages/store-postgres/docs/migrations.md\n";
p_d += "packages/store-postgres/docs/drivers.md\n";
p_d += "packages/store-postgres/docs/guarantees.md\n";
p_d += "packages/store-postgres/README.md\n";
p_d += "FIX P11-TENANT-1 honesty: tenantColumn enables a nullable tenant_id column + index only. v1 does NOT isolate tenants, does NOT write tenant_id from stores, does NOT use a custom column name in DDL (always tenant_id), PK remains key. Operators who need isolation must prefix keys or wait for a later schema. Do not claim isolation.\n";
p_d += "FIX P11-SCHEMA-1 docs: migratePostgresAdapter / migrate() create the schema when sqlSchema is set (CREATE SCHEMA IF NOT EXISTS). Operators still need CREATE privilege.\n";
p_d += "FIX P11-DOC-3: listDue/SKIP LOCKED — say listDue soft-releases expired claimed then SELECTs; SKIP LOCKED is optional fairness not used on the default scan.\n";
p_d += "Drizzle: 12.3 optional schema exports were not shipped; /drizzle is notes + executor pass-through. Say that clearly in drivers.md.\n";
p_d += "Statuses: postgres never writes idempotency status expired (reclaim uses lease_expires_at); webhook fail writes pending/dead_letter not failed. failed/expired remain CHECK-legal for operator/SQL and memory expire-on-read.\n";
p_d += "Webhook columns gateway, provider_event_id, first_received_at, last_received_at exist for operator/index use; claim() does not populate them (ClaimWebhookInput has no gateway).\n";
p_d += "Do not edit .ts production files.\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:foundation", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:postgres", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_c, label: "fix:later-adapters", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:docs", capability_mode: "all", output_schema: fix_schema },
]);

let fi = 0;
for f in fixes {
    log("Fix stream " + fi.to_string() + ": " + safe_summary(f));
    fi += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Typecheck and targeted Phase 11-12 tests");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root with command evidence (paste relevant fail lines):\n";
p_v += "1) bun run typecheck\n";
p_v += "2) bun test packages/sql-foundation packages/store-postgres packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects packages/store-contracts\n";
p_v += "Live PG suites may skip without PAYMENTS_SDK_PG_URL — that is OK.\n";
p_v += "3) Grep/read invariants:\n";
p_v += "   - classifyIdempotencyReserveMiss exists and checks completed before fingerprint\n";
p_v += "   - postgres idempotency miss uses that order (not fingerprint first)\n";
p_v += "   - memory-relational failWebhook has requireActiveLease: false\n";
p_v += "   - migrate emits CREATE SCHEMA IF NOT EXISTS when sqlSchema set\n";
p_v += "   - migrate version INSERT is ON CONFLICT DO NOTHING (postgres) or INSERT OR IGNORE\n";
p_v += "   - deleteExpired binds canonicalizeIsoTimestamp(input.before)\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass.\n";

let verify = agent(p_v, #{
    label: "verify:tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Phase 11-12 blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence.\n";
p_g += "BLOCKERS:\n";
p_g += "P11-IDEM-1: decide/classify/adapters: completed and indeterminate BEFORE fingerprint_conflict. Postgres + sqlite + turso + d1 + durable-objects miss paths.\n";
p_g += "P11-REF-1: memory-relational failWebhook requireActiveLease false.\n";
p_g += "P11-IDEM-2: classifyIdempotencyReserveMiss claimable + postgres canonicalize/retry (or documented equivalent that cannot freeze free expired reserved as in_progress).\n";
p_g += "P11-SCHEMA-1: CREATE SCHEMA IF NOT EXISTS when sqlSchema set.\n";
p_g += "P11-MIG-1: version INSERT idempotent (ON CONFLICT / OR IGNORE).\n";
p_g += "P11-DEL-1: postgres deleteExpired canonicalizes before.\n";
p_g += "P11-TENANT-1: docs no longer claim automatic tenant isolation (code may still not isolate — honesty is the required fix).\n";
p_g += "Typecheck/tests red is blocking (PG live skips OK).\n";
p_g += "Non-blocking allowed: unused xmax column, no Drizzle table defs, no TIMESTAMPTZ, SKIP LOCKED unused, gateway columns unpopulated if documented.\n";
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
if !gate_pass {
    log("Gate failed; remediating blockers");
    let p_r = "";
    p_r += "Repo: " + root + "\n";
    p_r += "Gate did not pass. Read remaining blockers and fix them. Do not commit.\n";
    if gate != () && gate.success && gate.output != () && gate.output.blocking != () {
        p_r += "Blockers: " + json_encode(gate.output.blocking) + "\n";
    }
    if verify != () && verify.success && verify.output != () && verify.output.failures != () {
        p_r += "Test failures: " + json_encode(verify.output.failures) + "\n";
    }
    p_r += "Priority: P11-IDEM-1 classification order across adapters, P11-REF-1 failWebhook, P11-IDEM-2 repair, P11-SCHEMA-1 CREATE SCHEMA, P11-MIG-1 ledger insert, P11-DEL-1 canonicalize, then typecheck/tests.\n";
    p_r += "Re-run failing bun tests after edits. Return {ok, fixed, remaining, summary}.\n";
    let rem = agent(p_r, #{
        label: "remediate:blockers",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    log("Remediate: " + safe_summary(rem));

    let p_v2 = "";
    p_v2 += "Re-verify " + root + " after remediation.\n";
    p_v2 += "bun run typecheck && bun test packages/sql-foundation packages/store-postgres packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects packages/store-contracts\n";
    p_v2 += "Re-read P11-IDEM-1/REF-1/SCHEMA-1/MIG-1/DEL-1. Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}.\n";
    let ver2 = agent(p_v2, #{
        label: "verify:post-remediate",
        capability_mode: "execute",
        output_schema: verify_schema,
    });
    log("Post-remediate verify: " + safe_summary(ver2));

    let p_g2 = "";
    p_g2 += "READ-ONLY re-gate of " + root + " after remediation. Fail closed on remaining P11-IDEM-1/REF-1/IDEM-2/SCHEMA-1/MIG-1/DEL-1.\n";
    p_g2 += "Return {pass, blocking, non_blocking, summary}.\n";
    let gate2 = agent(p_g2, #{
        label: "gate:post-remediate",
        capability_mode: "read-only",
        output_schema: gate_schema,
    });
    log("Post-remediate gate: " + safe_summary(gate2));
    if gate2 != () && gate2.success && gate2.output != () && gate2.output.pass == true {
        gate_pass = true;
    }
} else {
    log("Gate passed; skip remediate");
}

// ─── Report ──────────────────────────────────────────────────────
phase("Report");
let p_rep = "";
p_rep += "Write " + root + "/packages/sql-foundation/docs/phase-11-12-fix-gate-report.md\n";
p_rep += "Also copy or pointer-link from packages/store-postgres/docs/phase-11-12-fix-gate-report.md if that docs dir is the adapter home — prefer one canonical report under sql-foundation/docs and a short pointer in store-postgres/docs.\n";
p_rep += "Summarize critic, four fix streams, verify commands, gate verdict, remaining nits.\n";
p_rep += "Cite file paths. Do not invent fixes not in the tree. Return {ok, report_path, summary}.\n";
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
    summary: "Phase 11-12 critic/fix/verify/gate finished",
    gate_pass: gate_pass,
    report_path: report_path,
    critic: safe_summary(critic),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
});
