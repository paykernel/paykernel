let meta = #{
    name: "phase-18-adapter-matrix",
    description: "Phase 18 Adapter Capability Matrix and Selection Guide: critic, implement matrix+decision tree docs (honest guarantees only), integrate monorepo links, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 18 roadmap matrix, recommended defaults, acceptance criteria" },
        #{ title: "Implement", detail: "capability matrix, decision tree, selection guide docs; align with adapter manifests" },
        #{ title: "Integrate", detail: "wire monorepo/README/testkit/core pointers; keep Phase 0-17 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, boundaries, Phase 18 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 18" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 18 (Adapter Capability Matrix and Selection Guide) for PayKernel monorepo",
};

let critic_schema = #{
    "type": "object",
    "required": ["gaps", "already_present", "stream_plan", "risks", "summary"],
    "properties": #{
        "gaps": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "already_present": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "stream_plan": #{ "type": "string" },
        "risks": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["ok", "files_changed", "summary"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 150 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": [
        "ok", "typecheck_ok", "tests_ok", "build_ok", "boundaries_ok",
        "matrix_ok", "decision_tree_ok", "defaults_ok", "honesty_ok",
        "coverage_adapters_ok", "links_ok", "no_overclaim_ok", "compat_ok",
        "failures", "summary"
    ],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "typecheck_ok": #{ "type": "boolean" },
        "tests_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "boundaries_ok": #{ "type": "boolean" },
        "pack_ok": #{ "type": "boolean" },
        "coverage_ok": #{ "type": "boolean" },
        "matrix_ok": #{ "type": "boolean" },
        "decision_tree_ok": #{ "type": "boolean" },
        "defaults_ok": #{ "type": "boolean" },
        "honesty_ok": #{ "type": "boolean" },
        "coverage_adapters_ok": #{ "type": "boolean" },
        "links_ok": #{ "type": "boolean" },
        "no_overclaim_ok": #{ "type": "boolean" },
        "compat_ok": #{ "type": "boolean" },
        "failures": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 80 },
        "commands_run": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 50 },
        "summary": #{ "type": "string" },
    },
};

let gate_schema = #{
    "type": "object",
    "required": ["pass", "blocking", "non_blocking", "checklist", "summary"],
    "properties": #{
        "pass": #{ "type": "boolean" },
        "blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "non_blocking": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "checklist": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 60 },
        "summary": #{ "type": "string" },
        "report_path": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["ok", "fixed", "remaining"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "fixed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "remaining": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "summary": #{ "type": "string" },
    },
};

let root = if args == () || args.root == () {
    "/home/shahin/Documents/projects/personal/packages/paykernel"
} else {
    args.root
};

// ─── Critic ──────────────────────────────────────────────────────
phase("Critic");
log("Critic: auditing Phase 18 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 18 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 18 — Adapter Capability Matrix and Selection Guide\" completely\n";
p_critic += "(Objective, Initial Matrix, Recommended Defaults, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 9 phase ends with typecheck/tests/build/docs;\n";
p_critic += "  16 every adapter same conformance suite; 17 document crash boundaries;\n";
p_critic += "  3.5 Each Adapter Must Declare Its Guarantees (manifest honesty).\n";
p_critic += "Also section 3.1 (D1 and DO are SEPARATE packages),\n";
p_critic += "3.2 Do Not Treat Every SQLite Product as the Same Runtime,\n";
p_critic += "3.7 Local SQLite Is a Single-Host Default,\n";
p_critic += "Redis optional (not mandatory).\n";
p_critic += "Phases 0-17 are COMPLETE — preserve all adapters, core, webhooks, testkit, sql-store.\n";
p_critic += "Do NOT start Phase 19+ (reconciliation domain package), new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite adapter implementations unless docs need tiny honesty fixes.\n";
p_critic += "Do NOT create a new publishable package for Phase 18 — this is documentation + selection guide.\n\n";

p_critic += "CONTEXT — production adapters already present:\n";
p_critic += "- packages/store-postgres — multi-host durable SQL\n";
p_critic += "- packages/store-redis — optional; Bun / ioredis / node-redis / Upstash bindings\n";
p_critic += "- packages/store-sqlite — single-host; /bun /node /better-sqlite3\n";
p_critic += "- packages/store-turso — multi-host remote; /serverless /libsql (no /sync)\n";
p_critic += "- packages/store-d1 — multi-host Workers D1\n";
p_critic += "- packages/store-durable-objects — multi-host partitioned SQLite DO\n";
p_critic += "- packages/testkit — StorageAdapterManifest + memory non-production\n";
p_critic += "Each adapter publishes StorageAdapterManifest with coordinationScope, durability, claims, notes.\n\n";

p_critic += "Audit against EVERY Phase 18 requirement with evidence (grep/read):\n\n";

p_critic += "Objective: Make the correct adapter choice obvious to users and Codex.\n\n";

p_critic += "Initial Matrix rows that MUST appear (honest columns):\n";
p_critic += "Adapter | Distributed | Durable audit | Atomic claim | Best use | Important limitation\n";
p_critic += "- PostgreSQL\n";
p_critic += "- Redis/Valkey via Bun, ioredis, or node-redis\n";
p_critic += "- Upstash Redis\n";
p_critic += "- Bun SQLite\n";
p_critic += "- Node SQLite\n";
p_critic += "- better-sqlite3\n";
p_critic += "- Turso serverless\n";
p_critic += "- libSQL\n";
p_critic += "- Cloudflare D1\n";
p_critic += "- Cloudflare Durable Objects\n";
p_critic += "Optionally include memory testkit as NON-PRODUCTION only (explicit banner).\n\n";

p_critic += "Recommended Defaults (must be documented):\n";
p_critic += "- Existing PostgreSQL application → PostgreSQL adapter\n";
p_critic += "- Cloudflare app already using D1 → D1 adapter\n";
p_critic += "- Cloudflare app needing strong per-key coordination → Durable Object adapter\n";
p_critic += "- Bun single-server → Bun SQLite adapter\n";
p_critic += "- Globally deployed remote SQLite compatibility → Turso adapter\n";
p_critic += "- Existing Redis/Valkey → matching Redis binding, optionally paired with SQL audit storage\n";
p_critic += "- Bun already on Redis/Valkey → prefer /bun unless Cluster/Sentinel required\n";
p_critic += "- No existing Redis + moderate workload → primary relational/D1/DO; avoid adding Redis infrastructure\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1) documentation includes a decision tree AND a capability matrix.\n";
p_critic += "A2) no adapter is marketed beyond its tested deployment guarantees\n";
p_critic += "    (align matrix/limitations with each package's StorageAdapterManifest + guarantees.md).\n\n";

p_critic += "Deliverables expected (check presence):\n";
p_critic += "1) docs/adapter-selection.md (or equivalent central guide) with:\n";
p_critic += "   - full capability matrix (all roadmap rows)\n";
p_critic += "   - decision tree (flowchart or structured Q&A)\n";
p_critic += "   - recommended defaults list\n";
p_critic += "   - honesty notes: single-host vs multi-host; Redis optional; DO partitioned not global;\n";
p_critic += "     D1 vs DO separate; Turso not local SQLite; no multi-region ads without tests\n";
p_critic += "2) Links from root README, docs/monorepo.md, packages/testkit/docs/store-contracts.md\n";
p_critic += "3) Optional: packages/core/docs/storage-adapters.md pointer or short summary\n";
p_critic += "4) Optional machine-readable matrix JSON under docs/ or packages/testkit if useful — not required\n";
p_critic += "5) Gate report packages/core/docs/baseline/phase-18-gate-report.md (Gate owns write)\n\n";

p_critic += "Honesty cross-check (flag as risks if docs overclaim):\n";
p_critic += "- SQLite local: coordinationScope single-host only; never multi-host\n";
p_critic += "- Redis Bun: Cluster/Sentinel unsupported — must reject or document limitation\n";
p_critic += "- Upstash: HTTP model; durability configuration-dependent\n";
p_critic += "- Turso: multi-host remote; no /sync; embedded replica care\n";
p_critic += "- D1: multi-host; session-dependent RAW; not DO\n";
p_critic += "- DO: multi-host partitioned; never global DO; sharding required\n";
p_critic += "- Memory testkit: NON-PRODUCTION single-process ephemeral\n";
p_critic += "- Redis is never required to use the SDK\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: overclaiming multi-region; marketing local SQLite as distributed; Redis as mandatory;\n";
p_critic += "conflating D1/DO/turso/sqlite; decision tree missing; matrix incomplete; broken links;\n";
p_critic += "starting Phase 19 reconciliation package; inventing untested adapters.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase18-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase18-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 18 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 18\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 18 Adapter Capability Matrix in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core.\n";
common += "Testkit = packages/testkit — StorageAdapterManifest + conformance.\n";
common += "Adapters COMPLETE (preserve code; docs may link only):\n";
common += "  adapter-postgres, adapter-redis, adapter-sqlite, adapter-turso,\n";
common += "  adapter-cloudflare-d1, adapter-cloudflare-do.\n";
common += "PHASE 18 ONLY: documentation — capability matrix + decision tree + recommended defaults.\n";
common += "Do NOT create packages/reconciliation (Phase 19).\n";
common += "Do NOT create new adapter packages.\n";
common += "Do NOT create a generic packages/adapter-cloudflare package.\n";
common += "Do NOT rewrite adapter production code unless a one-line honesty typo in docs only.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs; re-read changed regions.\n";
common += "Tests source of truth for guarantees — matrix cells MUST match tested manifests, not marketing.\n";
common += "Read each adapter's manifest.ts + docs/guarantees.md (or overview) before writing rows.\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: primary selection guide docs
let p_a = "";
p_a += common;
p_a += "STREAM A — PRIMARY SELECTION GUIDE + CAPABILITY MATRIX + DECISION TREE.\n";
p_a += "OWN primarily: docs/adapter-selection.md (NEW — central Phase 18 deliverable).\n";
p_a += "May create docs/adapter-capability-matrix.md only if splitting improves clarity;\n";
p_a += "prefer ONE primary guide with matrix + decision tree + defaults in adapter-selection.md.\n";
p_a += "Do NOT write phase-18-gate-report.md (Gate owns it).\n";
p_a += "Do NOT implement Phase 19 reconciliation package.\n\n";

p_a += "### Create docs/adapter-selection.md\n";
p_a += "Title: Adapter selection guide (Phase 18)\n";
p_a += "Audience: application developers and coding agents (Codex).\n";
p_a += "Must include:\n\n";

p_a += "#### 1) Purpose\n";
p_a += "Explain that payment safety (idempotency, webhook inbox, reconciliation stores) needs an\n";
p_a += "honest storage adapter choice. Redis is optional. Local SQLite is single-host only.\n\n";

p_a += "#### 2) Capability matrix (roadmap Initial Matrix — expand with package names)\n";
p_a += "Markdown table with columns exactly (or superset with package path):\n";
p_a += "| Adapter | Package | Distributed | Durable audit | Atomic claim | Best use | Important limitation |\n";
p_a += "Rows (all required):\n";
p_a += "1. PostgreSQL — @paykernel/store-postgres — Yes / Yes / Yes — general production default — needs DB\n";
p_a += "2. Redis/Valkey (Bun, ioredis, node-redis) — adapter-redis subpaths — Yes except Bun Cluster/Sentinel limits — config-dependent durability — low-latency coordination — optional infra; Bun no Cluster/Sentinel\n";
p_a += "3. Upstash Redis — adapter-redis /upstash — Yes — config-dependent — serverless coordination — HTTP/network model\n";
p_a += "4. Bun SQLite — adapter-sqlite /bun — No single host — Yes durable disk — Yes — Bun local/server — not cross-host\n";
p_a += "5. Node SQLite — adapter-sqlite /node — No single host — Yes — Yes — Node local — runtime matrix varies by Node line\n";
p_a += "6. better-sqlite3 — adapter-sqlite /better-sqlite3 — No single host — Yes — Yes — mature Node SQLite — native dep; sync\n";
p_a += "7. Turso serverless — adapter-turso /serverless — Yes — Yes — Yes after conformance — remote SQLite-compatible — remote txn semantics\n";
p_a += "8. libSQL — adapter-turso /libsql — Yes or embedded — Yes — Yes after conformance — existing libSQL projects — replica care; no /sync export\n";
p_a += "9. Cloudflare D1 — adapter-cloudflare-d1 — Yes — Yes — Yes — Worker-native shared store — D1 API/session consistency; not DO\n";
p_a += "10. Cloudflare Durable Objects — adapter-cloudflare-do — Yes partitioned — Yes — Yes — strong per-key coordination — sharding + DO ops; never global DO\n";
p_a += "Optional NON-PRODUCTION row: Memory (testkit) — single-process ephemeral — NEVER production.\n\n";
p_a += "Align Distributed / Durable / Atomic cells with StorageAdapterManifest fields from each package.\n";
p_a += "If a cell would overclaim, use the weaker honest value and explain in Important limitation.\n\n";

p_a += "#### 3) Decision tree (REQUIRED by acceptance)\n";
p_a += "Provide a clear decision tree as:\n";
p_a += "- Mermaid flowchart OR nested numbered questions (both preferred if clean).\n";
p_a += "Questions should cover:\n";
p_a += "Q1: Existing PostgreSQL? → adapter-postgres\n";
p_a += "Q2: Cloudflare Workers + already on D1? → adapter-cloudflare-d1\n";
p_a += "Q3: Cloudflare Workers + need strong per-key serialization? → adapter-cloudflare-do (with sharding)\n";
p_a += "Q4: Bun single host / local file OK? → adapter-sqlite /bun\n";
p_a += "Q5: Need global remote SQLite-compatible multi-host? → adapter-turso\n";
p_a += "Q6: Already have Redis/Valkey? → matching redis binding; optionally + SQL for audit\n";
p_a += "Q7: Bun + Redis already? → prefer /bun unless Cluster/Sentinel → then ioredis/node-redis\n";
p_a += "Q8: No Redis and moderate load? → pick primary SQL/D1/DO; do NOT add Redis just because\n";
p_a += "Default fail-closed: if multi-host required and only local SQLite available → STOP; choose Postgres/Turso/D1/DO.\n\n";

p_a += "#### 4) Recommended defaults (roadmap list, expanded with package imports)\n";
p_a += "Bullet list matching roadmap Recommended Defaults exactly in spirit, with concrete package names.\n\n";

p_a += "#### 5) Honesty / anti-marketing section\n";
p_a += "Explicit bans:\n";
p_a += "- Do not market local SQLite as multi-host or multi-region.\n";
p_a += "- Do not market Redis as required for PayKernel.\n";
p_a += "- Do not market D1 as interchangeable with local SQLite or Turso or Durable Objects.\n";
p_a += "- Do not market DO as one global object or as shared multi-primary SQL.\n";
p_a += "- Do not market multi-region unless the adapter's tested guarantees include it (most say multi-host only).\n";
p_a += "- Do not market Turso embedded-replica /sync (package has no /sync export).\n";
p_a += "- Bun Redis: no Cluster/Sentinel — document rejection/limitation.\n";
p_a += "- Memory stores: NON-PRODUCTION only.\n\n";

p_a += "#### 6) Package quick reference\n";
p_a += "Table: package npm name | path | coordinationScope from manifest | primary factory example.\n";
p_a += "Link to each adapter README / docs/overview.md / docs/guarantees.md.\n\n";

p_a += "#### 7) Related docs\n";
p_a += "Links: monorepo.md, workspace-boundaries.md, testkit store-contracts.md, roadmap Phase 9-17.\n\n";

p_a += "### Quality bar\n";
p_a += "- Accurate package names and paths that exist in the repo.\n";
p_a += "- No invented adapters or untested capabilities.\n";
p_a += "- Codex-friendly: scannable tables, unambiguous defaults, fail-closed language.\n";
p_a += "Run no destructive git. After writing, re-read the file for consistency.\n";

let a_result = agent(p_a, #{
    label: "impl:18-selection-guide",
    capability_mode: "all",
    output_schema: implement_schema,
});

let a_ok = false;
let a_summary = "stream A failed";
if a_result != () && a_result.success && a_result.output != () {
    a_ok = a_result.output.ok == true;
    a_summary = a_result.output.summary;
    log("Stream A ok=" + a_ok.to_string() + " — " + a_summary);
} else {
    log("Stream A agent failed");
}

// Parallel: B honesty cross-check + small tests if any; C monorepo wiring
log("Implementing Phase 18 links and honesty wiring in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — HONESTY CROSS-CHECK + OPTIONAL MACHINE-READABLE MATRIX + LIGHT TESTS.\n";
p_b += "OWN: ensure docs/adapter-selection.md (or Stream A output) matches real manifests;\n";
p_b += "fix overclaims; optionally add a small unit test or script check if appropriate.\n";
p_b += "Do NOT write gate report. Do NOT start Phase 19.\n\n";

p_b += "### Honesty verification (REQUIRED)\n";
p_b += "For EACH production adapter, read:\n";
p_b += "  packages/adapter-*/src/manifest.ts (or equivalent)\n";
p_b += "  packages/adapter-*/docs/guarantees.md or overview.md if present\n";
p_b += "Verify matrix cells for Distributed / Durable audit / Atomic claim match:\n";
p_b += "  coordinationScope multi-host/multi-region → Distributed Yes (partitioned note for DO)\n";
p_b += "  single-host / single-process → Distributed No\n";
p_b += "  durability durable → Durable audit Yes; configuration-dependent → say so; ephemeral → No\n";
p_b += "  claims strong → Atomic claim Yes\n";
p_b += "Fix any overclaim in docs/adapter-selection.md.\n\n";

p_b += "### Optional but valuable: machine-readable matrix\n";
p_b += "If Stream A did not create it, consider docs/adapter-capability-matrix.json OR\n";
p_b += "packages/testkit/src/storage/adapter-selection-matrix.ts as a frozen constant used by a test.\n";
p_b += "If adding a test:\n";
p_b += "  - packages/testkit or scripts: assert matrix covers all roadmap adapters\n";
p_b += "  - assert no local sqlite row claims multi-host\n";
p_b += "  - assert Redis is marked optional / not required\n";
p_b += "Keep tests minimal and high-signal (test-guard: behavior of matrix honesty, not prose length).\n";
p_b += "If no code change is needed beyond docs, that is OK — still return ok=true with evidence of cross-check.\n\n";

p_b += "### After work\n";
p_b += "bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_b += "(only if code/tests changed; otherwise docs-only is fine but still run typecheck if any ts changed).\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — MONOREPO WIRING + POINTERS for Phase 18.\n";
p_c += "OWN: docs/monorepo.md, docs/workspace-boundaries.md (short pointer),\n";
p_c += "root README.md (if it lists packages/docs),\n";
p_c += "packages/testkit/docs/store-contracts.md pointer to adapter-selection guide,\n";
p_c += "packages/core/docs/ optional storage-adapters.md or link from a hub doc,\n";
p_c += "each adapter README may gain one line 'See docs/adapter-selection.md for matrix' (optional, minimal).\n";
p_c += "Do NOT write phase-18-gate-report.md (Gate owns it).\n\n";

p_c += "### monorepo.md updates\n";
p_c += "Add docs/adapter-selection.md to the layout tree under docs/.\n";
p_c += "Add a short section 'Choosing a storage adapter (Phase 18)' linking the guide.\n";
p_c += "Reaffirm Redis optional, SQLite single-host, D1 vs DO separate.\n\n";

p_c += "### workspace-boundaries.md\n";
p_c += "One short paragraph or row pointing to adapter-selection for capability honesty.\n\n";

p_c += "### testkit store-contracts.md\n";
p_c += "Pointer: production adapter choice → ../../docs/adapter-selection.md (adjust relative path).\n\n";

p_c += "### Root README\n";
p_c += "If packages are listed, add link to Adapter selection guide.\n\n";

p_c += "### Do NOT\n";
p_c += "Change root package.json build filters unless needed (Phase 18 is docs-first).\n";
p_c += "Do not add new workspace packages.\n";

let jobs = [
    #{ prompt: p_b, label: "impl:18-honesty-check", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:18-docs-wiring", capability_mode: "all", output_schema: implement_schema },
];

let impl_results = parallel(jobs);
let impl_ok = if a_ok { 1 } else { 0 };
let impl_fail = if a_ok { 0 } else { 1 };
let impl_i = 0;
while impl_i < impl_results.len() {
    let r = impl_results[impl_i];
    if r != () && r.success && r.output != () && r.output.ok == true {
        impl_ok += 1;
        log("OK implement: " + r.output.summary);
    } else {
        impl_fail += 1;
        log("FAIL implement slot " + impl_i.to_string());
    }
    impl_i += 1;
}
log("Implement done ok=" + impl_ok.to_string() + " fail=" + impl_fail.to_string());

// ─── Integrate ───────────────────────────────────────────────────
phase("Integrate");
let p_int = "";
p_int += "You are integrating Phase 18 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 19 reconciliation package.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) docs/adapter-selection.md exists with capability matrix covering all roadmap rows.\n";
p_int += "2) Decision tree present (mermaid and/or structured Q&A).\n";
p_int += "3) Recommended defaults documented (roadmap list).\n";
p_int += "4) Honesty section: no overclaims vs StorageAdapterManifests.\n";
p_int += "5) Links from monorepo.md, testkit store-contracts, root README (as applicable).\n";
p_int += "6) Redis optional; SQLite single-host; D1 ≠ DO ≠ Turso ≠ local SQLite clearly stated.\n";
p_int += "7) Phase 0-17 safety: typecheck, full adapter tests, build, boundaries green.\n";
p_int += "8) No new packages/reconciliation or adapter packages.\n";
p_int += "9) If Stream A failed, write the full selection guide yourself — Phase 18 cannot ship without matrix+tree.\n";
p_int += "10) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase18",
    capability_mode: "all",
    output_schema: implement_schema,
});
if int_result == () || !int_result.success || int_result.output.ok != true {
    log("Integrate reported issues — verify will surface details");
} else {
    log("Integrate OK: " + int_result.output.summary);
}

// ─── Verify ──────────────────────────────────────────────────────
phase("Verify");
let p_ver = "";
p_ver += "Verify Phase 18 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) bun run typecheck\n";
p_ver += "3) bun run typecheck:types\n";
p_ver += "4) bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_ver += "5) bun test --coverage packages/core\n";
p_ver += "6) bun run build\n";
p_ver += "7) bun run check:boundaries\n";
p_ver += "8) bun run check:runtime-portability\n";
p_ver += "9) bun run validate:package\n";
p_ver += "10) Evidence docs/adapter-selection.md exists with matrix table\n";
p_ver += "11) Evidence decision tree present (mermaid or Q&A)\n";
p_ver += "12) Evidence recommended defaults section matches roadmap spirit\n";
p_ver += "13) Evidence all 10 roadmap adapter rows present (Postgres, Redis multi, Upstash, Bun/Node/better sqlite, Turso serverless, libSQL, D1, DO)\n";
p_ver += "14) Evidence honesty: sqlite not multi-host; redis optional; DO partitioned; D1≠DO\n";
p_ver += "15) Evidence links from monorepo and testkit docs\n";
p_ver += "16) Spot-check 3+ adapter manifests vs matrix cells for overclaim\n";
p_ver += "17) Evidence no packages/reconciliation created\n\n";
p_ver += "Set flags:\n";
p_ver += "- matrix_ok: full capability matrix present with required rows\n";
p_ver += "- decision_tree_ok: decision tree present and usable\n";
p_ver += "- defaults_ok: recommended defaults documented\n";
p_ver += "- honesty_ok: no overclaims vs manifests\n";
p_ver += "- coverage_adapters_ok: all roadmap adapters listed with package names\n";
p_ver += "- links_ok: monorepo/testkit/README pointers\n";
p_ver += "- no_overclaim_ok: same as honesty with explicit anti-marketing language present\n";
p_ver += "- compat_ok: Phase 0-17 green; no illegal packages\n";
p_ver += "Set ok=true only if typecheck, tests, build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase18",
    capability_mode: "all",
    output_schema: verify_schema,
});

let verify_ok = false;
let verify_summary = "verify agent failed";
let verify_failures = "";
if ver != () && ver.success && ver.output != () {
    verify_ok = ver.output.ok == true;
    verify_summary = ver.output.summary;
    log("Verify: ok=" + verify_ok.to_string() + " — " + verify_summary);
    if ver.output.failures != () {
        verify_failures = json_encode(ver.output.failures);
    }
    write_scratch_file("phase18-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 18 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 18 — each PASS or BLOCKING:\n";
p_gate += "A1) documentation includes a decision tree and a capability matrix.\n";
p_gate += "    Evidence: docs/adapter-selection.md (or equivalent) with both artifacts readable.\n";
p_gate += "A2) no adapter is marketed beyond its tested deployment guarantees.\n";
p_gate += "    Evidence: matrix/limitations match manifests; honesty section; spot-check overclaims.\n\n";
p_gate += "Also require:\n";
p_gate += "- All Initial Matrix adapter rows present with package names\n";
p_gate += "- Recommended defaults present\n";
p_gate += "- Redis optional; SQLite single-host; D1≠DO≠Turso≠local SQLite\n";
p_gate += "- Links from monorepo/testkit\n";
p_gate += "- Phase 0-17 safety net still green\n";
p_gate += "- No Phase 19 reconciliation package sneak-in\n";
p_gate += "- No logical bugs: incomplete matrix; missing tree; overclaim multi-region;\n";
p_gate += "  Redis required; global DO marketing; broken relative links.\n\n";
p_gate += "Independently re-run:\n";
p_gate += "  bun test packages/core packages/testkit packages/webhooks internal/sql-store packages/store-postgres packages/store-redis packages/store-sqlite packages/store-turso packages/store-d1 packages/store-durable-objects\n";
p_gate += "  bun run typecheck; check:boundaries.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/core/docs/baseline/phase-18-gate-report.md\n";
p_gate += "AND optionally docs/phase-18-gate-report.md pointer.\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase18-adversarial",
    capability_mode: "all",
    output_schema: gate_schema,
});

let gate_pass = false;
let blocking_json = "[]";
let gate_summary = "gate agent failed";
if gate != () && gate.success && gate.output != () {
    gate_pass = gate.output.pass == true;
    gate_summary = gate.output.summary;
    if gate.output.blocking != () {
        blocking_json = json_encode(gate.output.blocking);
    }
    log("Gate pass=" + gate_pass.to_string() + " — " + gate_summary);
    write_scratch_file("phase18-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 18 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 18 only — no Phase 19 reconciliation package.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete docs/adapter-selection.md: matrix, decision tree, defaults, honesty, links.\n";
    p_fix += "Preserve Phase 0-17 adapters and safety net.\n";
    p_fix += "After fixes re-run typecheck, full tests, build, boundaries, runtime-portability, validate:package.\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase18-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 18 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, full package tests, coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm matrix + decision tree + honesty with file evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase18-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase18-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 18 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A2 with independent evidence.\n";
    p_gate2 += "Update packages/core/docs/baseline/phase-18-gate-report.md.\n";
    p_gate2 += "pass=true only if acceptance criteria and matrix+tree are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase18-final",
        capability_mode: "all",
        output_schema: gate_schema,
    });
    if gate2 != () && gate2.success && gate2.output != () {
        gate_pass = gate2.output.pass == true;
        gate_summary = gate2.output.summary;
        if gate2.output.blocking != () {
            blocking_json = json_encode(gate2.output.blocking);
        }
        log("Final gate pass=" + gate_pass.to_string() + " — " + gate_summary);
        write_scratch_file("phase18-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 18 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 18,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
