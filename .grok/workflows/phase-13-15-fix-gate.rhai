let meta = #{
    name: "phase-13-15-fix-gate",
    description: "Critic, fix, verify, and adversarially gate Phase 13-15 review findings",
    phases: [
        #{ title: "Critic", detail: "confirm each Phase 13-15 finding still present" },
        #{ title: "Fix", detail: "four non-overlapping implementation streams" },
        #{ title: "Verify", detail: "typecheck plus redis sqlite turso tests" },
        #{ title: "Gate", detail: "adversarial re-check of blocking fixes" },
        #{ title: "Remediate", detail: "close remaining blockers" },
        #{ title: "Report", detail: "write gate report" },
    ],
    when_to_use: "After a Phase 13-15 (store-redis + store-sqlite + store-turso) review; fix recon attempts, cluster recovery, libsql tx join, then gate",
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
log("Confirming Phase 13-15 findings in " + root);

let p_c = "";
p_c += "READ-ONLY critic. Repo: " + root + "\n";
p_c += "Use read_file and grep. Do not edit. Do not answer from memory.\n";
p_c += "For each ID say STILL PRESENT or ALREADY FIXED with file:line evidence.\n";
p_c += "P1315-REDIS-1: store-redis RECON_CLAIM_LUA always increments attempts including expired claimed reclaim; RECON_GET_LUA / listDue soft-release does not restore an attempt. SQL/webhook keep-on-reclaim + restore-on-soft-release. Evidence: packages/store-redis/src/scripts/reconciliation.lua.ts attempts + 1 and GET_LUA HSET without attempts decrement.\n";
p_c += "P1315-REDIS-2: listRetryable/listDue recovery uses cluster-unaware SCAN then GET Lua after claim ZREMs the due/retry ZSET. ioredis/node-redis Cluster SCAN hits one random node; abandoned HASH on other masters never re-index. Evidence: packages/store-redis/src/stores/shared.ts softReleaseExpiredClaimedViaScan SCAN; claim Lua ZREM.\n";
p_c += "P1315-TURSO-1: store-turso libsql driver txDepth/activeQueryable are process-global on the executor. Concurrent withTransaction silently joins the first interactive stream. Store ALS cannot prevent the join. Evidence: packages/store-turso/src/drivers/libsql.ts if txDepth > 0 join path. Unit test uses mock independent txs.\n";
p_c += "P1315-REDIS-3: retentionTtlMs still EXPIRE dead_letter / failed / manual_review fences (completed PERSIST is correct). After TTL EXISTS==0 so next webhook claim is acquired not duplicate_failed. Evidence: WEBHOOK_FAIL_LUA / RECON_FAIL_LUA / RECON_MARK_MANUAL_REVIEW_LUA EXPIRE.\n";
p_c += "P1315-REDIS-4: IDEMPOTENCY_RESERVE_LUA classifies fingerprint_conflict BEFORE completed/indeterminate. Contract + decideIdempotencyReserve + classifyIdempotencyReserveMiss require terminals first. Evidence: packages/store-redis/src/scripts/idempotency.lua.ts fp ~= fingerprint before status==completed.\n";
p_c += "P1315-REDIS-5: deleteExpired Lua compares updated_at > beforeIso lexically; no canonicalizeIsoTimestamp on input.before. Offset before vs stored Z can delete live fences. Evidence: IDEMPOTENCY_DELETE_IF_EXPIRED_LUA / WEBHOOK_DELETE / RECON_DELETE.\n";
p_c += "P1315-SQLITE-1: store-sqlite serializeResultJson is JSON.stringify only; no MAX_RESULT_JSON_BYTES fail-closed (STORES-3). Postgres/D1/Turso/Redis throw StoreSerializationFailureError. Evidence: packages/store-sqlite/src/stores/shared.ts serializeResultJson.\n";
p_c += "P1315-SQLITE-2: Bun sqlite run() treats non-number changes as 0. safeIntegers bigint changes => false miss / lease_lost after commit. Node/better-sqlite3 normalizeChanges. Evidence: packages/store-sqlite/src/drivers/bun.ts typeof result?.changes === number.\n";
p_c += "P1315-TURSO-2: preferInteractiveTransaction only when protocol is http/ws/wss. Missing protocol on a remote duck-typed client uses sequential BEGIN IMMEDIATE via client.execute (not one txn on HTTP). Evidence: packages/store-turso/src/drivers/libsql.ts preferInteractiveTransaction.\n";
p_c += "P1315-TURSO-3: createExecutorFromLibsql accepts file+syncUrl / replica clients under TURSO_STORAGE_ADAPTER_MANIFEST coordinationScope multi-host and staleReadsPossible false.\n";
p_c += "P1315-REDIS-6: docs/scripts-atomicity.md and crash-boundaries claim WEBHOOK_FAIL_LUA requires unexpired lease; code accepts matching token after expiry (WEBHOOKS-2).\n";
p_c += "P1315-SQLITE-3: createSchemaNamespace sqlSchema is accepted and emitted as quoted schema.table; migrate never CREATE SCHEMA on sqlite.\n";
p_c += "P1315-TEST-1: turso concurrency/conformance if (!opened) return or catch-return pass with zero assertions; sqlite node/better-sqlite3 skip-clean return.\n";
p_c += "Return confirmed[] as ID strings, already_fixed[], summary.\n";

let critic = agent(p_c, #{
    label: "critic:phase-13-15",
    capability_mode: "read-only",
    output_schema: critic_schema,
});
log("Critic: " + safe_summary(critic));

// ─── Fix ─────────────────────────────────────────────────────────
phase("Fix");
log("Four non-overlapping Phase 13-15 fix streams");

let rules = "";
rules += "Repo: " + root + "\n";
rules += "Do NOT commit or push. Read files before edit. Minimal diffs. Add tests that fail before the fix.\n";
rules += "OWN FILES ONLY. Return {ok, files_changed, fixed_ids, summary, notes}.\n";
rules += "Match existing style. Do not weaken tests. Prefer fail-closed money/lease status.\n";

let p_a = rules;
p_a += "STREAM A REDIS LOGIC. Files ONLY under packages/store-redis/src/ (scripts, stores, clock helpers, tests). Do not edit sqlite/turso.\n";
p_a += "FIX P1315-REDIS-1: RECON_CLAIM_LUA increment attempts only when status == scheduled (expired claimed reclaim keeps attempts). RECON_GET_LUA / listDue soft-release must restore one attempt (floor 0) like WEBHOOK_GET_LUA. Add registry.test.ts + mock/unit test: reclaim after lease expiry does not increase attempts; listDue soft-release decrements then scheduled reclaim nets to original.\n";
p_a += "FIX P1315-REDIS-2: Do not rely on cluster-unaware SCAN for recovery. On claim, ZADD the due/retry index with lease_expires_ms (not ZREM) so after expiry ZRANGEBYSCORE(-inf, now) rediscovers abandoned claimed keys with only keyed ZSET ops (Cluster-safe, same hash tag). Complete/fail/dead_letter still ZREM. GET_LUA still soft-releases expired claimed. SCAN bulk soft-release may remain as standalone extra but must not be the only recovery path. Add a comment + unit/mock test that claim leaves an index member scored at lease expiry.\n";
p_a += "FIX P1315-REDIS-3: WEBHOOK_FAIL_LUA dead_letter, RECON_FAIL_LUA terminal failed, RECON_MARK_MANUAL_REVIEW_LUA must PERSIST (never EXPIRE) like completed. Cleanup only via deleteExpired. Update registry.test.ts STORES-5 to assert those scripts have no redis.call EXPIRE. Add/adjust mock test.\n";
p_a += "FIX P1315-REDIS-4: IDEMPOTENCY_RESERVE_LUA classify completed then indeterminate then fingerprint_conflict (same as classifyIdempotencyReserveMiss). Add stores.mock.test or registry+mock: completed + other fingerprint => already_completed; indeterminate + other => indeterminate.\n";
p_a += "FIX P1315-REDIS-5: canonicalize input.before (and list nowIso if written) to Date ISO Z before Lua ARGV lexical compare. Fail closed on invalid before (reuse msFromIso / toISOString). Prefer also store/compare updated_ms if already present; otherwise canonicalize the string. Test offset before does not delete a later Z updated_at.\n";
p_a += "Do not delete public retentionIndexKey export (docs stream owns docs). You may stop calling unused helpers if unused inside src.\n";

let p_b = rules;
p_b += "STREAM B SQLITE. Files ONLY under packages/store-sqlite/:\n";
p_b += "src/stores/shared.ts\n";
p_b += "src/stores/idempotency-store.ts (only if needed for serialize)\n";
p_b += "src/stores/stores.unit.test.ts\n";
p_b += "src/drivers/bun.ts\n";
p_b += "src/drivers/drivers.unit.test.ts (or existing driver tests)\n";
p_b += "src/index-stores.ts / src/types.ts / src/migrate.ts only if rejecting sqlSchema.\n";
p_b += "FIX P1315-SQLITE-1 STORES-3: serializeResultJson must throw StoreSerializationFailureError when JSON exceeds MAX_RESULT_JSON_BYTES from @paykernel/sql-foundation (same message style as postgres/turso). Add unit test oversized result rejected.\n";
p_b += "FIX P1315-SQLITE-2: bun run() must normalize bigint changes like node/better-sqlite3 (safe integer Number). Extract or copy normalizeChanges. Test changes 1n => 1 (mock stmt.run).\n";
p_b += "FIX P1315-SQLITE-3: createSqlite*Store / migrateSqliteAdapter / resolveStoreContext must reject namespace.sqlSchema (StoreInvalidSchemaError or TypeError with clear message). SQLite has no CREATE SCHEMA. Test migrate/factory rejects sqlSchema.\n";
p_b += "Do not edit store-redis or store-turso.\n";

let p_c = rules;
p_c += "STREAM C TURSO DRIVER. Files ONLY under packages/store-turso/src/drivers/ plus driver tests and store-turso unit tests that already exist:\n";
p_c += "src/drivers/libsql.ts\n";
p_c += "src/drivers/drivers.unit.test.ts\n";
p_c += "src/stores/stores.unit.test.ts only if you must adjust withTransaction tests\n";
p_c += "src/concurrency.turso.test.ts\n";
p_c += "src/conformance.turso.test.ts\n";
p_c += "FIX P1315-TURSO-1: do NOT join concurrent withTransaction. If txDepth > 0, throw StoreUnsupportedFeatureError (or StoreUnavailableError) saying the libsql client already has a write transaction — do not silently join. Nested same-callback store ALS does not need driver join (inner getExecutor is the tx without transaction()). Add a driver test: overlapping executor.transaction calls must not share a stream (second throws or uses a distinct txn object — prefer throw).\n";
p_c += "FIX P1315-TURSO-2: preferInteractiveTransaction when client.transaction exists UNLESS protocol is explicitly file (or empty protocol that is clearly local). Missing protocol on a client that has transaction() must use interactive write, not BEGIN IMMEDIATE on sequential execute. Test: protocol omitted + transaction() present => interactive path.\n";
p_c += "FIX P1315-TURSO-3: refuse replica/sync clients. If client has syncUrl, or constructor-like replica fields, or a documented replica flag, throw with a message that embedded replicas are not multi-host. If you cannot see syncUrl on the official client type, add an optional LibsqlStoreOptions.allowEmbeddedReplica default false and refuse protocol===file combined with a syncUrl option you add to LibsqlStoreOptions. Document in a short comment. Test the refuse path.\n";
p_c += "FIX P1315-TEST-1 for turso only: concurrency.turso.test.ts and conformance.turso.test.ts must not pass via bare return when libsql fails to open. Use describe.skip / it.skip with a reason, or throw if @libsql/client is installed (it is a package devDependency). Live remote may still skipIf(!hasLiveTurso()).\n";
p_c += "Do not rewrite claim SQL in stores (inline UPSERT is OK). Do not edit store-redis or store-sqlite.\n";

let p_d = rules;
p_d += "STREAM D DOCS + SQLITE SKIP-CLEAN HONESTY + REDIS DOC LIES. Files ONLY docs/README/tests listed:\n";
p_d += "packages/store-redis/docs/scripts-atomicity.md\n";
p_d += "packages/store-redis/docs/crash-boundaries.md\n";
p_d += "packages/store-redis/docs/key-design.md\n";
p_d += "packages/store-redis/docs/hybrid-examples.md\n";
p_d += "packages/store-redis/docs/drivers.md\n";
p_d += "packages/store-redis/docs/guarantees.md\n";
p_d += "packages/store-sqlite/docs/crash-boundaries.md\n";
p_d += "packages/store-sqlite/docs/overview.md\n";
p_d += "packages/store-sqlite/docs/claims.md\n";
p_d += "packages/store-sqlite/docs/guarantees.md\n";
p_d += "packages/store-sqlite/src/conformance.sqlite.test.ts (skip honesty only)\n";
p_d += "packages/store-turso/docs/drivers.md\n";
p_d += "packages/store-turso/docs/embedded-replicas.md\n";
p_d += "packages/store-turso/docs/overview.md\n";
p_d += "FIX P1315-REDIS-6: webhook fail accepts matching token after expiry (WEBHOOKS-2); complete still requires unexpired lease. Recon fail still requires unexpired lease. Do not say webhook fail matches complete fence.\n";
p_d += "REDIS-3 docs: completed AND terminal dead_letter/failed/manual_review fences are not EXPIRE; deleteExpired only. Fix key-design/hybrid if they say EXPIRE after complete/fail.\n";
p_d += "REDIS-2 docs: recovery is keyed ZSET (lease-expiry score), not Cluster SCAN. SCAN is optional extra on standalone.\n";
p_d += "SQLITE docs: crash-boundaries recon soft-release RESTORES attempts (decrement), does not preserve. Foundation is @paykernel/sql-foundation not internal/sql-store. Manifest type from store-contracts. single-host only.\n";
p_d += "TURSO docs: remote write tx is client.transaction(write); BEGIN IMMEDIATE is local file only. Embedded replica not multi-host.\n";
p_d += "FIX P1315-TEST-1 sqlite: node:sqlite / better-sqlite3 suites must it.skip or describe.skip when driver unavailable — never silent return that looks like a pass with no expect.\n";
p_d += "Do not change production Lua/SQL/driver logic (streams A-C own that).\n";

let fixes = parallel([
    #{ prompt: p_a, label: "fix:redis", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_b, label: "fix:sqlite", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_c, label: "fix:turso", capability_mode: "all", output_schema: fix_schema },
    #{ prompt: p_d, label: "fix:docs", capability_mode: "all", output_schema: fix_schema },
]);

let fi = 0;
for f in fixes {
    log("Fix stream " + fi.to_string() + ": " + safe_summary(f));
    fi += 1;
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
log("Typecheck and targeted Phase 13-15 tests");

let p_v = "";
p_v += "Repo: " + root + "\n";
p_v += "Run from repo root with command evidence (paste relevant fail lines):\n";
p_v += "1) bun run typecheck\n";
p_v += "2) bun test packages/store-redis packages/store-sqlite packages/store-turso packages/store-contracts packages/sql-foundation\n";
p_v += "Live Redis/Turso suites may skip without PAYMENTS_SDK_REDIS_URL / TURSO_DATABASE_URL — that is OK.\n";
p_v += "3) Grep/read invariants (must hold):\n";
p_v += "   - RECON_CLAIM_LUA increments attempts only for scheduled (or equivalent keep-on-claimed)\n";
p_v += "   - RECON_GET_LUA restores attempts on expired claimed soft-release\n";
p_v += "   - IDEMPOTENCY_RESERVE_LUA completed/indeterminate before fingerprint_conflict\n";
p_v += "   - WEBHOOK_FAIL / RECON_FAIL terminal / MARK_MANUAL_REVIEW have no redis.call EXPIRE\n";
p_v += "   - sqlite serializeResultJson throws on oversized JSON\n";
p_v += "   - bun driver normalizes bigint changes\n";
p_v += "   - libsql driver does not join concurrent txDepth (throws or isolated txn)\n";
p_v += "   - preferInteractiveTransaction true when transaction() exists and protocol is not file\n";
p_v += "Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}. ok only if typecheck and tests pass.\n";

let verify = agent(p_v, #{
    label: "verify:tests",
    capability_mode: "execute",
    output_schema: verify_schema,
});
log("Verify: " + safe_summary(verify));

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
log("Adversarial gate of Phase 13-15 blockers");

let p_g = "";
p_g += "READ-ONLY adversarial gate. Repo: " + root + "\n";
p_g += "Fail closed. Use read_file/grep. Do NOT trust implement summaries. pass=true only if ALL blockers below are gone with file:line evidence.\n";
p_g += "BLOCKERS:\n";
p_g += "P1315-REDIS-1: recon expired claimed reclaim does not burn attempts; soft-release restores.\n";
p_g += "P1315-REDIS-2: abandoned claimed rediscovery works with keyed ZSET (lease-expiry score) without requiring Cluster SCAN.\n";
p_g += "P1315-TURSO-1: libsql concurrent withTransaction does not silently join (throws or isolated txn).\n";
p_g += "P1315-REDIS-3: no EXPIRE on dead_letter / recon failed / manual_review (PERSIST or omit).\n";
p_g += "P1315-REDIS-4: completed/indeterminate before fingerprint_conflict in reserve Lua.\n";
p_g += "P1315-REDIS-5: deleteExpired before is canonical Z or numeric ms (not raw offset lexical).\n";
p_g += "P1315-SQLITE-1: serializeResultJson fail-closed at MAX_RESULT_JSON_BYTES.\n";
p_g += "P1315-SQLITE-2: bun changes bigint normalized.\n";
p_g += "P1315-TURSO-2: missing protocol + transaction() uses interactive write, not fake BEGIN on HTTP.\n";
p_g += "Typecheck/tests red is blocking (live Redis/Turso skips OK).\n";
p_g += "Non-blocking allowed: remaining skip-clean native ABI, unused retentionIndexKey export, inline Turso claim SQL if equivalent, replica refuse implemented as option flag, docs nits.\n";
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
    p_r += "Priority: P1315-REDIS-1 attempts, P1315-REDIS-2 ZSET recovery, P1315-TURSO-1 no join, P1315-REDIS-3/4/5, P1315-SQLITE-1/2, P1315-TURSO-2, then typecheck/tests.\n";
    p_r += "Re-run failing bun tests after edits. Return {ok, fixed, remaining, summary}.\n";
    let rem = agent(p_r, #{
        label: "remediate:blockers",
        capability_mode: "all",
        output_schema: rem_schema,
    });
    log("Remediate: " + safe_summary(rem));

    let p_v2 = "";
    p_v2 += "Re-verify " + root + " after remediation.\n";
    p_v2 += "bun run typecheck && bun test packages/store-redis packages/store-sqlite packages/store-turso packages/store-contracts packages/sql-foundation\n";
    p_v2 += "Re-read P1315-REDIS-1/2/3/4/5 TURSO-1/2 SQLITE-1/2. Return {ok, typecheck_ok, tests_ok, failures, commands_run, summary}.\n";
    let ver2 = agent(p_v2, #{
        label: "verify:post-remediate",
        capability_mode: "execute",
        output_schema: verify_schema,
    });
    log("Post-remediate verify: " + safe_summary(ver2));

    let p_g2 = "";
    p_g2 += "READ-ONLY re-gate of " + root + " after remediation. Fail closed on remaining P1315-REDIS-1/2/3/4/5 TURSO-1/2 SQLITE-1/2.\n";
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
p_rep += "Write " + root + "/packages/store-redis/docs/phase-13-15-fix-gate-report.md\n";
p_rep += "Add a short pointer file at " + root + "/packages/store-sqlite/docs/phase-13-15-fix-gate-report.md and " + root + "/packages/store-turso/docs/phase-13-15-fix-gate-report.md linking to the redis canonical report.\n";
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
    summary: "Phase 13-15 critic/fix/verify/gate finished",
    gate_pass: gate_pass,
    report_path: report_path,
    critic: safe_summary(critic),
    verify: safe_summary(verify),
    gate: safe_summary(gate),
});
