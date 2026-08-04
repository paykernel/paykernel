let meta = #{
    name: "phase-10-webhook-inbox",
    description: "Phase 10 Webhook Inbox Engine: critic, implement @paykernel/webhooks (claim/dedupe/retry/audit, modes, outcomes, leases, crash tests), integrate monorepo, verify, adversarial gate",
    phases: [
        #{ title: "Critic", detail: "audit gaps vs Phase 10 roadmap 10.1-10.6 and acceptance criteria" },
        #{ title: "Implement", detail: "package scaffold, engine, store contract ownership, tests, docs" },
        #{ title: "Integrate", detail: "wire monorepo scripts, boundaries, public API, keep Phase 0-9 green" },
        #{ title: "Verify", detail: "typecheck, tests, build, pack, boundaries, Phase 10 evidence" },
        #{ title: "Gate", detail: "adversarial acceptance criteria check against roadmap Phase 10" },
        #{ title: "Remediate", detail: "fix blocking gate items if any" },
    ],
    when_to_use: "Implement roadmap Phase 10 (Webhook Inbox Engine) for PayKernel monorepo",
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
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 120 },
        "summary": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": [
        "ok", "typecheck_ok", "tests_ok", "build_ok", "boundaries_ok",
        "package_exists_ok", "processing_model_ok", "inbox_record_ok",
        "modes_ok", "outcomes_ok", "lease_renewal_ok", "crash_boundaries_ok",
        "acceptance_ok", "docs_ok", "compat_ok",
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
        "package_exists_ok": #{ "type": "boolean" },
        "processing_model_ok": #{ "type": "boolean" },
        "inbox_record_ok": #{ "type": "boolean" },
        "modes_ok": #{ "type": "boolean" },
        "outcomes_ok": #{ "type": "boolean" },
        "lease_renewal_ok": #{ "type": "boolean" },
        "crash_boundaries_ok": #{ "type": "boolean" },
        "acceptance_ok": #{ "type": "boolean" },
        "docs_ok": #{ "type": "boolean" },
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
log("Critic: auditing Phase 10 gaps in " + root);

let p_critic = "";
p_critic += "You are the Phase 10 critic for the PayKernel monorepo at " + root + ".\n";
p_critic += "READ-ONLY audit: use read_file, list_dir, grep, and inspect-only shell commands.\n";
p_critic += "Do NOT edit files. Do NOT commit. Do NOT push.\n\n";
p_critic += "Read roadmap.md section \"# Phase 10 — Webhook Inbox Engine\" completely\n";
p_critic += "(Objective, Package @paykernel/webhooks, 10.1 Processing Model,\n";
p_critic += "10.2 Inbox Record, 10.3 Processing Modes, 10.4 Acknowledgment Policy,\n";
p_critic += "10.5 Lease Renewal, 10.6 Crash Boundaries, Acceptance Criteria).\n";
p_critic += "Also read Mandatory Engineering Rules (section 4), especially:\n";
p_critic += "  1 tests source of truth; 5 no secret leakage; 6 no framework coupling;\n";
p_critic += "  7 no Node-only in portable packages; 9 phase ends with typecheck/tests/build/docs;\n";
p_critic += "  11 atomicity by storage engine not get/set; 14 no raw payloads by default;\n";
p_critic += "  15 portable timestamps/IDs; 17 document crash boundaries;\n";
p_critic += "  18 do not acknowledge failed webhook work silently.\n";
p_critic += "Also section 3.3 Prefer Atomic Single-Statement Claims, 3.4 Separate Contracts from Driver Bindings\n";
p_critic += "(webhooks owns webhook inbox contracts), 5.1 package boundary rules.\n";
p_critic += "Phases 0-9 are COMPLETE — preserve monorepo, plugin architecture, capabilities, testkit,\n";
p_critic += "money, typed outcomes, PaymentEvent dual-write, PaymentRuntime, store contracts, pack validation.\n";
p_critic += "Do NOT start Phase 11+ real DB adapters (postgres/sqlite/d1/redis/turso/do),\n";
p_critic += "Phase 14 reconciliation package, new PSPs, or gateway extraction.\n";
p_critic += "Do NOT rewrite Phase 5-9 money/outcomes/events/runtime/store-contracts unless required for wiring.\n\n";

p_critic += "CONTEXT already present from Phase 9 (interim home until webhooks package):\n";
p_critic += "- packages/testkit/src/storage/contracts.ts WebhookInboxStore (claim/renew/complete/fail/get/listRetryable/deleteExpired)\n";
p_critic += "- packages/testkit/src/memory/memory-stores.ts createMemoryWebhookInboxStore\n";
p_critic += "- packages/testkit/src/storage/webhook-inbox-conformance.ts\n";
p_critic += "- core hashWebhookPayload, toPersistedPaymentEventEnvelope, WebhookEvent, PaymentEvent\n";
p_critic += "- core PaymentClient.handleWebhook verifies+normalizes (no inbox yet)\n";
p_critic += "There is NO packages/webhooks yet and NO @paykernel/webhooks.\n\n";

p_critic += "Audit against EVERY Phase 10 requirement with evidence (grep/read):\n\n";

p_critic += "10.1 Processing Model — ordered steps must be implemented as an engine API:\n";
p_critic += "1 receive raw request (app-owned or injected verify path)\n";
p_critic += "2 verify signature/authenticity (injected verifier — engine must not hardcode PSPs)\n";
p_critic += "3 normalize the event\n";
p_critic += "4 calculate stable payload hash (use core hashWebhookPayload or accept precomputed)\n";
p_critic += "5 derive key from gateway + provider event ID\n";
p_critic += "6 atomically claim the event via WebhookInboxStore.claim\n";
p_critic += "7 reject/report conflicting duplicate payload (payload_conflict)\n";
p_critic += "8 run application handler\n";
p_critic += "9 mark complete using lease token\n";
p_critic += "10 on failure, sanitized error + next retry decision\n\n";

p_critic += "10.2 Inbox Record fields — engine/docs must use store records covering:\n";
p_critic += "event key, gateway, provider event ID/type, schema version, optional normalized envelope,\n";
p_critic += "payload hash, state, attempt count, lease owner/token/expiry, first/last received,\n";
p_critic += "next attempt, completion timestamp, sanitized last error.\n";
p_critic += "MUST NOT persist raw signatures, auth headers, secret tokens, unredacted provider payloads.\n";
p_critic += "Note: Phase 9 WebhookInboxRecord is leaner — Phase 10 may extend via payloadRef/envelope\n";
p_critic += "or engine-side metadata; document mapping honestly if store fields stay minimal.\n\n";

p_critic += "10.3 Processing Modes — EXPLICIT, never implicit mix:\n";
p_critic += "- inline: request waits for handler; failure → retryable outcome (app maps to HTTP)\n";
p_critic += "- durable_retry: persist normalized envelope; may ACK after durable claim per policy\n\n";

p_critic += "10.4 Acknowledgment Policy — expose outcomes (not hardcoded HTTP):\n";
p_critic += "processed | duplicate_completed | already_processing(+retryAfterMs?) |\n";
p_critic += "scheduled_for_retry | handler_failed(+retryable) | payload_conflict | invalid_webhook\n\n";

p_critic += "10.5 Lease Renewal — long handlers renew; stale token renewal fails.\n\n";

p_critic += "10.6 Crash Boundaries — document AND test:\n";
p_critic += "before claim; after claim before handler; during handler;\n";
p_critic += "after external side effect before complete; after completion.\n";
p_critic += "Handler must remain idempotent (document why).\n\n";

p_critic += "Acceptance criteria:\n";
p_critic += "A1 concurrent duplicate deliveries do not execute the same handler concurrently\n";
p_critic += "A2 completed events do not execute again\n";
p_critic += "A3 expired leases can be reclaimed\n";
p_critic += "A4 stale workers cannot complete reclaimed work\n";
p_critic += "A5 conflicting payloads are reported\n";
p_critic += "A6 inline and durable retry modes are explicit\n\n";

p_critic += "Package boundaries:\n";
p_critic += "- packages/webhooks = @paykernel/webhooks (NEW publishable portable package)\n";
p_critic += "- webhooks may depend on core (@paykernel/core) only for stable event/hash/runtime types\n";
p_critic += "- webhooks must NOT depend on testkit, adapters, frameworks, Redis, DB drivers\n";
p_critic += "- core must NOT depend on webhooks or testkit\n";
p_critic += "- testkit MAY depend on webhooks for engine integration tests / re-exports\n";
p_critic += "- paymentsSdk.portable: true; no node:/bun: in production sources\n\n";

p_critic += "Contract ownership (roadmap 3.4): webhooks owns webhook inbox contracts.\n";
p_critic += "Phase 9 put WebhookInboxStore in testkit temporarily. Phase 10 must either:\n";
p_critic += "(preferred) own WebhookInboxStore types in webhooks and keep structural compatibility with\n";
p_critic += "testkit memory/conformance (testkit may re-export or dual-type with assignability tests), OR\n";
p_critic += "define engine store interface in webhooks that is structurally assignable both ways.\n";
p_critic += "Do NOT make production webhooks import @paykernel/testkit.\n\n";

p_critic += "Also check monorepo wiring gaps: root package.json build/test/typecheck scripts only core+testkit;\n";
p_critic += "docs/monorepo.md, workspace-boundaries.md still say webhooks is future;\n";
p_critic += "no webhooks CHANGELOG/README/gate report.\n\n";

p_critic += "List concrete GAPS. List ALREADY_PRESENT with file evidence. stream_plan for implement order.\n";
p_critic += "risks: silent ACK of failures; mixing modes; storing secrets; get-then-set claims;\n";
p_critic += "core depending on webhooks; webhooks depending on testkit; breaking Phase 9 store API;\n";
p_critic += "framework coupling; Node-only imports; Phase 11 adapters; non-idempotent handler assumptions.\n";
p_critic += "Return gaps[], already_present[], stream_plan, risks[], summary.\n";

let critic = agent(p_critic, #{
    label: "critic:phase10-audit",
    capability_mode: "execute",
    output_schema: critic_schema,
});

let critic_json = "{}";
if critic != () && critic.success && critic.output != () {
    log("Critic: " + critic.output.summary);
    critic_json = json_encode(critic.output);
    write_scratch_file("phase10-critic.json", critic_json);
} else {
    log("Critic agent failed — implement uses full Phase 10 checklist");
    critic_json = "{\"summary\":\"critic failed; implement full Phase 10\"}";
}

// ─── Implement ───────────────────────────────────────────────────
phase("Implement");
log("Implementing Phase 10 Webhook Inbox Engine in " + root);

let common = "";
common += "Repo root: " + root + "\n";
common += "Monorepo: Bun workspaces. Core = packages/core = @paykernel/core (0.8.0).\n";
common += "Testkit = packages/testkit = @paykernel/testkit (0.1.0) — Phase 9 store contracts + memory.\n";
common += "PHASE 10 ONLY: create @paykernel/webhooks and the webhook inbox engine.\n";
common += "Do NOT create adapter-postgres / adapter-sqlite / adapter-redis / adapter-d1 packages (Phase 11+).\n";
common += "Do NOT create packages/reconciliation (Phase 14). Do NOT add new PSPs or extract gateways.\n";
common += "Do NOT commit. Do NOT push. Do NOT publish.\n";
common += "Rules: read files BEFORE edit; minimal surgical diffs outside webhooks; re-read changed regions.\n";
common += "Tests are source of truth. Preserve Phase 0-9 fully.\n";
common += "Mandatory engineering rules (MUST FOLLOW):\n";
common += "1) Tests cover every behavior change (unit + concurrency + crash + modes).\n";
common += "2) No unsafe mutation retries without native idempotency or atomic dedup.\n";
common += "3) Never convert uncertain outcomes into failure.\n";
common += "4) Do not hide provider differences — engine is gateway-agnostic via injectables.\n";
common += "5) No secret leakage in errors/logs/stored records (sanitize lastError).\n";
common += "6) No framework coupling (no Express/Hono HTTP status hardcoding in engine).\n";
common += "7) No Node-only assumptions — portable package (Web APIs / injectable clock).\n";
common += "8) Keep 0.x compat: core + testkit public APIs stable; additive only.\n";
common += "9) Phase ends with typecheck, tests, build, package validation, docs.\n";
common += "10) exactOptionalPropertyTypes is ON — no undefined assignment to optional props without care.\n";
common += "11) Core must NOT depend on webhooks or testkit.\n";
common += "12) Webhooks must NOT depend on testkit or adapters or Redis.\n";
common += "13) Atomic claim via store.claim only — never get-then-set race in the engine.\n";
common += "14) Portable ISO-8601 timestamps and opaque string lease tokens.\n";
common += "15) Do not store raw provider payloads/signatures/headers by default.\n";
common += "16) Document crash boundaries; handler must be idempotent (document).\n";
common += "17) Do not silently acknowledge failed work — return explicit WebhookProcessingOutcome.\n";
common += "18) Modes inline vs durable_retry are explicit constructor/config (never implicit mix).\n";
common += "Critic report (JSON): " + critic_json + "\n";
common += "Return {ok, files_changed, summary, notes}.\n\n";

// Stream A: Package scaffold + store contract ownership + core engine
let p_a = "";
p_a += common;
p_a += "STREAM A — PACKAGE + STORE CONTRACT + WEBHOOK INBOX ENGINE (Tasks 10.1, 10.2, 10.3, 10.4, 10.5).\n";
p_a += "OWN primarily: packages/webhooks/** (NEW package).\n";
p_a += "May touch root package.json scripts, docs/monorepo.md, docs/workspace-boundaries.md ONLY if needed\n";
p_a += "for package discovery — prefer leave monorepo wiring polish to Integrate if Stream A is large.\n";
p_a += "Do NOT write phase-10-gate-report.md (Gate owns it).\n\n";

p_a += "### Create package packages/webhooks\n";
p_a += "Name: @paykernel/webhooks version 0.1.0\n";
p_a += "type module; exports \".\"; main/types dist; files: dist, docs, README, LICENSE\n";
p_a += "dependency: @paykernel/core workspace:*\n";
p_a += "devDependencies: @types/bun, typescript (mirror testkit)\n";
p_a += "paymentsSdk: { portable: true }\n";
p_a += "publishConfig access public provenance true\n";
p_a += "scripts: build (bun build + build:types), typecheck, test — mirror testkit quality\n";
p_a += "tsconfig extends ../../tsconfig.base.json, rootDir src, outDir dist, exclude tests from emit\n";
p_a += "Copy MIT LICENSE from packages/core or testkit\n";
p_a += "After package.json exists: run bun install from monorepo root so workspace links resolve.\n\n";

p_a += "### Recommended source layout\n";
p_a += "packages/webhooks/src/\n";
p_a += "  index.ts                    # public exports only\n";
p_a += "  types.ts                    # WebhookProcessingOutcome, modes, keys, engine options\n";
p_a += "  store.ts                    # domain WebhookInboxStore contract (webhooks-owned)\n";
p_a += "  event-key.ts                # deriveWebhookEventKey(gateway, providerEventId)\n";
p_a += "  sanitize.ts                 # sanitizeWebhookError — strip secrets, max length\n";
p_a += "  engine.ts                   # createWebhookInboxEngine + process pipeline\n";
p_a += "  public-api.test.ts          # freeze exports\n";
p_a += "  engine.test.ts              # behavioral + acceptance + crash tests\n";
p_a += "  engine.concurrency.test.ts  # concurrent claim/handler tests\n";
p_a += "  engine.modes.test.ts        # inline vs durable_retry explicit\n";
p_a += "  event-key.test.ts\n";
p_a += "  sanitize.test.ts\n";
p_a += "  store.assignability.test.ts # structural compat with testkit store if both exist\n\n";

p_a += "### Domain store contract (webhooks owns — roadmap 3.4)\n";
p_a += "Define WebhookInboxStore + claim/renew/complete/fail/get/listRetryable types in packages/webhooks/src/store.ts.\n";
p_a += "Match Phase 9 testkit semantics so createMemoryWebhookInboxStore is structurally assignable:\n";
p_a += "- claim → acquired | already_completed | in_progress | payload_hash_conflict | duplicate_failed\n";
p_a += "- renew requires leaseToken; rotates token; increments generation; lease_lost on stale\n";
p_a += "- complete/fail require leaseToken; stale → throw lease-lost style error\n";
p_a += "Include a portable StoreLeaseLostError (or equivalent) in webhooks so the engine does not import testkit.\n";
p_a += "Document that durable adapters must pass the same conformance suite (still in testkit).\n";
p_a += "OPTIONAL Phase 10: testkit re-exports webhooks store types — only if zero-break; else keep dual + assignability test.\n";
p_a += "NEVER import @paykernel/testkit from packages/webhooks production code.\n\n";

p_a += "### Event key\n";
p_a += "deriveWebhookEventKey(gateway, providerEventId): string — stable, non-empty parts required.\n";
p_a += "Recommended format: gateway + ':' + providerEventId (document; reject empty).\n\n";

p_a += "### WebhookProcessingOutcome (exact discriminants from roadmap 10.4)\n";
p_a += "```ts\n";
p_a += "type WebhookProcessingOutcome =\n";
p_a += "  | { outcome: \"processed\" }\n";
p_a += "  | { outcome: \"duplicate_completed\" }\n";
p_a += "  | { outcome: \"already_processing\"; retryAfterMs?: number }\n";
p_a += "  | { outcome: \"scheduled_for_retry\" }\n";
p_a += "  | { outcome: \"handler_failed\"; retryable: boolean }\n";
p_a += "  | { outcome: \"payload_conflict\" }\n";
p_a += "  | { outcome: \"invalid_webhook\"; reason?: string };\n";
p_a += "```\n";
p_a += "Use exactOptionalPropertyTypes-safe construction (omit optional keys when absent).\n\n";

p_a += "### Modes (10.3) — explicit on engine options\n";
p_a += "type WebhookProcessingMode = \"inline\" | \"durable_retry\";\n";
p_a += "createWebhookInboxEngine({ store, mode, owner?, defaultLeaseMs?, clock?, maxAttempts?, sanitizeError?, ... })\n";
p_a += "INVARIANT: mode is fixed at construction; process() does not silently switch modes.\n";
p_a += "Inline: await handler; on handler throw → fail store (retryable) → return handler_failed { retryable: true }\n";
p_a += "  (unless handler marks non-retryable / deadLetter policy). Do NOT invent HTTP codes.\n";
p_a += "Durable: after successful claim, optionally return scheduled_for_retry path for worker-driven\n";
p_a += "  processing OR process handler then complete; when ackAfterClaim policy is true and handler\n";
p_a += "  is deferred to processRetryable, return scheduled_for_retry AFTER durable claim with envelope\n";
p_a += "  payloadRef/envelope persisted via store payloadRef (JSON of sanitized envelope only).\n";
p_a += "Design a clean API:\n";
p_a += "  - processVerified(...) for verified+normalized input (primary)\n";
p_a += "  - processWithVerifier(...) optional wrapper: verifyAndNormalize callback → invalid_webhook | processVerified\n";
p_a += "  - processRetryable(...) for durable workers polling listRetryable\n";
p_a += "  - renewLease(key, leaseToken, leaseMs?)\n";
p_a += "Handler context MUST expose renew() bound to current lease token (updates token after rotate).\n\n";

p_a += "### Processing model implementation (10.1)\n";
p_a += "processVerified pipeline:\n";
p_a += "1) validate inputs (gateway, providerEventId, payloadHash non-empty) else invalid_webhook\n";
p_a += "2) key = deriveWebhookEventKey(gateway, providerEventId)\n";
p_a += "3) claim via store.claim({ key, payloadHash, owner, leaseMs, payloadRef? })\n";
p_a += "4) map claim kinds:\n";
p_a += "   - already_completed → duplicate_completed (DO NOT run handler)\n";
p_a += "   - in_progress → already_processing (optional retryAfterMs from lease expiry delta)\n";
p_a += "   - payload_hash_conflict → payload_conflict\n";
p_a += "   - duplicate_failed → handler_failed retryable:false OR invalid_webhook — pick one consistent policy and document\n";
p_a += "     (recommend: treat dead_letter/failed terminal as handler_failed { retryable: false })\n";
p_a += "   - acquired → continue\n";
p_a += "5) if mode durable_retry && options.ackAfterClaim === true && !runHandlerInline:\n";
p_a += "   leave claimed or transition per design; prefer: store envelope on claim payloadRef, release to pending\n";
p_a += "   with availableAt=now for worker, return scheduled_for_retry — OR keep claimed and return scheduled\n";
p_a += "   ONLY if that matches docs. Prefer simpler: durable_retry always runs handler in processVerified\n";
p_a += "   like inline BUT on failure schedules retry via store.fail(retryAfterMs) and returns\n";
p_a += "   scheduled_for_retry when mode is durable_retry, vs handler_failed when mode is inline.\n";
p_a += "   ALSO provide processRetryable for re-driving pending rows.\n";
p_a += "6) run handler with ctx { key, leaseToken, record, event, renew, mode, gateway, providerEventId }\n";
p_a += "7) on success: store.complete({ key, leaseToken }) → processed\n";
p_a += "8) on handler throw: sanitize error; store.fail({ key, leaseToken, error, retryAfterMs?, deadLetter? });\n";
p_a += "   inline → handler_failed { retryable: !deadLetter }; durable_retry → scheduled_for_retry if retryable else handler_failed\n";
p_a += "9) on complete throwing lease_lost after handler success: document crash boundary\n";
p_a += "   (external side effect done, completion lost) — return handler_failed retryable true OR a documented outcome;\n";
p_a += "   do NOT claim success if complete failed.\n\n";

p_a += "### Payload hash\n";
p_a += "Accept precomputed payloadHash from caller (from core hashWebhookPayload).\n";
p_a += "Optional helper computePayloadHash(raw) re-exporting/wrapping core hashWebhookPayload.\n";
p_a += "Never hash secrets into storage beyond redacted core hash.\n\n";

p_a += "### Lease renewal (10.5)\n";
p_a += "ctx.renew(leaseMs?) calls store.renew; on ok updates closed-over leaseToken for subsequent complete;\n";
p_a += "on lease_lost throws or returns error — handler should abort. Engine renewLease API same semantics.\n";
p_a += "Stale renew MUST fail (store contract).\n\n";

p_a += "### Sanitize errors\n";
p_a += "Default: message truncated (e.g. 512 chars), strip patterns for sk_live, whsec_, Bearer, secret_token, etc.\n";
p_a += "Never put raw payload or signature into lastError.\n\n";

p_a += "### Clock\n";
p_a += "Inject optional clock { nowMs(): number } for tests; default Date.now. Do not import testkit FakeClock type;\n";
p_a += "structural match is enough so tests can pass createFakeClock().\n\n";

p_a += "### Public exports (index.ts)\n";
p_a += "createWebhookInboxEngine, deriveWebhookEventKey, computePayloadHash (if any),\n";
p_a += "sanitizeWebhookError, StoreLeaseLostError (webhooks), isStoreLeaseLostError,\n";
p_a += "types: WebhookProcessingOutcome, WebhookProcessingMode, WebhookInboxStore, WebhookInboxRecord,\n";
p_a += "ClaimWebhook*, engine option types, handler types.\n";
p_a += "public-api.test.ts freezes runtime export names.\n\n";

p_a += "### Tests Stream A (must prove acceptance criteria)\n";
p_a += "Use bun:test. For store: either implement a tiny in-package MemoryWebhookInboxStore for unit tests\n";
p_a += "(preferred — keeps webhooks independent of testkit in CI for this package) OR\n";
p_a += "devDependency on testkit only in tests — PREFER in-package test memory store matching contract\n";
p_a += "to avoid webhooks→testkit dependency entirely (even dev is ok for tests but zero dep is cleaner).\n";
p_a += "Required cases:\n";
p_a += "- A1 concurrent processVerified same key: only one handler runs (Promise.all double delivery)\n";
p_a += "- A2 completed event second process → duplicate_completed, handler not called\n";
p_a += "- A3 expire lease (fake clock), reclaim, handler runs again\n";
p_a += "- A4 stale leaseToken cannot complete after reclaim\n";
p_a += "- A5 different payloadHash → payload_conflict, handler not called\n";
p_a += "- A6 mode is explicit; durable_retry failure returns scheduled_for_retry; inline returns handler_failed\n";
p_a += "- invalid_webhook on empty gateway/id\n";
p_a += "- already_processing while lease active\n";
p_a += "- renew succeeds; wrong token renew fails\n";
p_a += "- handler success → processed; store status completed\n";
p_a += "- sanitize strips secret-like substrings\n";
p_a += "- crash abandon then reclaim (10.6)\n";
p_a += "- document via test names: before claim, after claim before handler, during handler, after side effect before complete, after complete\n";
p_a += "Run: cd packages/webhooks && bun test\n";
p_a += "Also ensure package typechecks: bun run typecheck in package.\n";

let a_result = agent(p_a, #{
    label: "impl:10-engine",
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

// Parallel streams B (docs) and C (monorepo + testkit wiring + crash docs)
log("Implementing Phase 10 docs and monorepo wiring in parallel");

let p_b = "";
p_b += common;
p_b += "STREAM B — DOCUMENTATION for Phase 10 (packages/webhooks docs + cross-links).\n";
p_b += "OWN: packages/webhooks/README.md, packages/webhooks/docs/webhook-inbox.md (NEW),\n";
p_b += "packages/webhooks/docs/crash-boundaries.md (NEW),\n";
p_b += "packages/webhooks/CHANGELOG.md Unreleased Phase 10,\n";
p_b += "cross-links in packages/core/docs/webhooks.md and packages/core/docs/webhook-events.md\n";
p_b += "(pointer only: inbox engine lives in @paykernel/webhooks),\n";
p_b += "packages/testkit/docs/store-contracts.md note that engine is Phase 10 webhooks package,\n";
p_b += "docs/workspace-boundaries.md and docs/monorepo.md update layout (webhooks present),\n";
p_b += "docs/releases.md if package table lists publishable packages.\n";
p_b += "Do NOT write phase-10-gate-report.md (Gate owns it).\n";
p_b += "If packages/webhooks does not exist yet, create docs after reading Stream A files;\n";
p_b += "if package still missing, create docs tree + README that match the intended API from roadmap.\n\n";

p_b += "### packages/webhooks/docs/webhook-inbox.md MUST cover\n";
p_b += "1) Purpose: storage-agnostic claim/dedupe/retry/audit for webhooks\n";
p_b += "2) Processing model steps 1-10 with code sample using createWebhookInboxEngine\n";
p_b += "3) How to verify via PaymentClient.handleWebhook or gateway.verify then processVerified\n";
p_b += "4) Event key derivation and payload hash (core hashWebhookPayload)\n";
p_b += "5) Inbox record fields and what must NOT be stored\n";
p_b += "6) Modes inline vs durable_retry — explicit config, never implicit\n";
p_b += "7) WebhookProcessingOutcome table and how frameworks map to HTTP (examples only, not hardcoding)\n";
p_b += "8) Lease renewal for long handlers (ctx.renew)\n";
p_b += "9) Integration with WebhookInboxStore + memory store for tests + future adapters\n";
p_b += "10) Handler idempotency requirement\n";
p_b += "11) Package boundary: depends on core only; not on testkit/adapters\n\n";

p_b += "### packages/webhooks/docs/crash-boundaries.md MUST cover 10.6\n";
p_b += "Each scenario: what store state is, whether handler ran, whether provider will retry,\n";
p_b += "what outcome the app should surface, why handler must be idempotent.\n";
p_b += "Scenarios: crash before claim; after claim before handler; during handler;\n";
p_b += "after external side effect before inbox complete; after completion.\n\n";

p_b += "### README\n";
p_b += "Install, quickstart with memory store or injected store, mode choice, outcomes, link to docs.\n\n";

p_b += "### CHANGELOG\n";
p_b += "Unreleased: initial @paykernel/webhooks — inbox engine, modes, outcomes, lease renewal.\n\n";

p_b += "### Cross-links accuracy\n";
p_b += "Re-read actual engine exports after writing; fix any wrong API names.\n";
p_b += "Do not invent Phase 11 adapters.\n";

let p_c = "";
p_c += common;
p_c += "STREAM C — MONOREPO WIRING + TESTKIT INTEGRATION + ENGINE CRASH TESTS HARDENING.\n";
p_c += "OWN: root package.json scripts (build/test/typecheck include webhooks),\n";
p_c += "docs/monorepo.md, docs/workspace-boundaries.md (webhooks present, portable, may depend on core),\n";
p_c += "scripts/validate-package.sh only if it hardcodes packages (extend carefully),\n";
p_c += "optional packages/testkit dependency on webhooks for integration test that\n";
p_c += "createMemoryWebhookInboxStore works with createWebhookInboxEngine,\n";
p_c += "packages/testkit/src/... optional engine-integration.test.ts,\n";
p_c += "packages/webhooks crash boundary tests if Stream A left gaps,\n";
p_c += "tsconfig root project references if used.\n";
p_c += "Do NOT write gate report.\n\n";

p_c += "### Root package.json updates (required)\n";
p_c += "build: core && testkit && webhooks (order: core first, then webhooks, then testkit if testkit depends on webhooks;\n";
p_c += "  if testkit does NOT depend on webhooks: core, testkit, webhooks)\n";
p_c += "typecheck: include webhooks\n";
p_c += "test: bun test packages/core packages/testkit packages/webhooks\n";
p_c += "build:types: include webhooks\n";
p_c += "description mention webhooks package\n\n";

p_c += "### Boundaries\n";
p_c += "Run bun run check:boundaries after wiring; fix any violations.\n";
p_c += "Ensure portable production sources in webhooks have no node:/bun: imports.\n";
p_c += "Update workspace-boundaries.md expected layout: webhooks present.\n\n";

p_c += "### Integration proof\n";
p_c += "If webhooks has in-package memory store for tests, also add one test in testkit OR webhooks that\n";
p_c += "uses createMemoryWebhookInboxStore from testkit via structural typing — place that test in\n";
p_c += "packages/testkit (testkit may depend on webhooks) as engine-memory-integration.test.ts.\n";
p_c += "If that forces testkit→webhooks dependency, add workspace:* carefully and rebuild order core→webhooks→testkit.\n";
p_c += "If dependency is too risky for this phase, skip testkit dep and keep webhooks self-contained tests only;\n";
p_c += "document that memory store from testkit is structurally compatible (assignability test in webhooks).\n\n";

p_c += "### Crash boundary tests (10.6) — ensure present\n";
p_c += "Named tests for each crash scenario with comments. Prefer packages/webhooks/src/engine.crash.test.ts.\n\n";

p_c += "### After wiring run\n";
p_c += "bun install\n";
p_c += "bun run --filter @paykernel/webhooks build || (cd packages/webhooks && bun run build)\n";
p_c += "bun test packages/webhooks\n";
p_c += "bun run check:boundaries\n";

let jobs = [
    #{ prompt: p_b, label: "impl:10-docs", capability_mode: "all", output_schema: implement_schema },
    #{ prompt: p_c, label: "impl:10-monorepo", capability_mode: "all", output_schema: implement_schema },
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
p_int += "You are integrating Phase 10 work in " + root + ".\n";
p_int += "Do NOT commit. Do NOT start Phase 11+ adapters or reconciliation package.\n";
p_int += "Fix cross-stream inconsistencies until the tree is coherent and green.\n\n";
p_int += "MANDATORY END STATE:\n";
p_int += "1) packages/webhooks exists as @paykernel/webhooks@0.1.0 with portable:true.\n";
p_int += "2) createWebhookInboxEngine implements processing model 10.1 via store.claim + handler + complete/fail.\n";
p_int += "3) WebhookProcessingOutcome matches roadmap 10.4 discriminants exactly.\n";
p_int += "4) Modes inline | durable_retry are explicit; no silent mix.\n";
p_int += "5) deriveWebhookEventKey(gateway, providerEventId) exists and is tested.\n";
p_int += "6) Domain WebhookInboxStore owned by webhooks (or structural contract); no webhooks→testkit import.\n";
p_int += "7) Lease renewal works; stale renew/complete fails.\n";
p_int += "8) Sanitize errors; no secrets/raw payloads stored by default.\n";
p_int += "9) Crash boundary docs + tests for all five scenarios.\n";
p_int += "10) Acceptance A1-A6 proven by tests (concurrent, completed, reclaim, stale, conflict, modes).\n";
p_int += "11) Docs: webhook-inbox.md, crash-boundaries.md, README, CHANGELOG.\n";
p_int += "12) Root scripts build/test/typecheck include webhooks; monorepo + boundaries docs updated.\n";
p_int += "13) Core does not depend on webhooks/testkit; webhooks does not depend on testkit/adapters.\n";
p_int += "14) Phase 0-9 safety: typecheck, tests core+testkit+webhooks, build, boundaries, runtime portability green.\n";
p_int += "15) No real DB adapter packages created.\n";
p_int += "16) exactOptionalPropertyTypes clean.\n";
p_int += "17) Public API freeze test for webhooks exports.\n";
p_int += "18) From root FIX until green:\n";
p_int += "    bun install\n";
p_int += "    bun run typecheck && bun run typecheck:types\n";
p_int += "    bun test packages/core packages/testkit packages/webhooks\n";
p_int += "    bun test --coverage packages/core\n";
p_int += "    bun run build\n";
p_int += "    bun run check:boundaries\n";
p_int += "    bun run check:runtime-portability\n";
p_int += "    bun run validate:package\n";
p_int += "19) If Stream A failed, implement the full package yourself — Phase 10 cannot ship without the engine.\n";
p_int += "20) If docs/API names mismatch code, fix docs to match code (or fix code to match roadmap).\n";
p_int += "21) Ensure dist builds for webhooks (index.js + .d.ts).\n";
p_int += "Return {ok, files_changed, summary, notes}.\n";

let int_result = agent(p_int, #{
    label: "integrate:phase10",
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
p_ver += "Verify Phase 10 completion in " + root + " with hard evidence from commands and file reads.\n";
p_ver += "You MAY fix trivial breakages found during verification so the suite can complete.\n";
p_ver += "Do NOT commit.\n\n";
p_ver += "Run and record results for EACH:\n";
p_ver += "1) cd " + root + " && bun install\n";
p_ver += "2) cd " + root + " && bun run typecheck\n";
p_ver += "3) cd " + root + " && bun run typecheck:types\n";
p_ver += "4) cd " + root + " && bun test packages/core packages/testkit packages/webhooks\n";
p_ver += "5) cd " + root + " && bun test --coverage packages/core\n";
p_ver += "6) cd " + root + " && bun run build\n";
p_ver += "7) test -f packages/webhooks/dist/index.js && test -f packages/core/dist/index.js && test -f packages/testkit/dist/index.js\n";
p_ver += "8) bun run check:boundaries\n";
p_ver += "9) bun run check:runtime-portability\n";
p_ver += "10) bun run validate:package\n";
p_ver += "11) Evidence package: packages/webhooks/package.json name @paykernel/webhooks, portable true\n";
p_ver += "12) Evidence createWebhookInboxEngine + process pipeline uses store.claim (grep engine.ts)\n";
p_ver += "13) Evidence WebhookProcessingOutcome discriminants match roadmap 10.4\n";
p_ver += "14) Evidence modes inline | durable_retry explicit\n";
p_ver += "15) Evidence deriveWebhookEventKey\n";
p_ver += "16) Evidence lease renew + stale rejection tests\n";
p_ver += "17) Evidence crash boundary docs + tests (five scenarios)\n";
p_ver += "18) Evidence A1-A6 tests pass\n";
p_ver += "19) Evidence no secrets in stored errors (sanitize tests)\n";
p_ver += "20) Evidence webhooks package.json has no testkit/adapter deps\n";
p_ver += "21) Evidence core package.json has no webhooks dep\n";
p_ver += "22) Evidence NO packages/adapter-* Phase 11 packages\n";
p_ver += "23) Evidence docs webhook-inbox.md + crash-boundaries.md exist and match API\n\n";
p_ver += "Set flags from evidence:\n";
p_ver += "- package_exists_ok: packages/webhooks + exports + dist\n";
p_ver += "- processing_model_ok: 10.1 pipeline implemented\n";
p_ver += "- inbox_record_ok: 10.2 fields documented + store usage without raw secrets\n";
p_ver += "- modes_ok: 10.3 explicit modes\n";
p_ver += "- outcomes_ok: 10.4 outcomes exact\n";
p_ver += "- lease_renewal_ok: 10.5 renew + stale fail\n";
p_ver += "- crash_boundaries_ok: 10.6 docs + tests\n";
p_ver += "- acceptance_ok: A1-A6 tests green\n";
p_ver += "- docs_ok: README + docs + CHANGELOG + monorepo links\n";
p_ver += "- compat_ok: Phase 0-9 green; boundaries; no illegal deps\n";
p_ver += "Set ok=true only if typecheck, tests (all three packages), build, boundaries, and ALL feature flags pass.\n";
p_ver += "Return full verify_schema.\n";

let ver = agent(p_ver, #{
    label: "verify:phase10",
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
    write_scratch_file("phase10-verify.json", json_encode(ver.output));
} else {
    log("Verify agent failed");
}

// ─── Gate ────────────────────────────────────────────────────────
phase("Gate");
let p_gate = "";
p_gate += "Adversarial gate for Phase 10 of " + root + ".\n";
p_gate += "You are a skeptical reviewer. Fail closed: missing evidence = blocking.\n";
p_gate += "Use read_file, grep, and run commands. Do not trust implementer claims without evidence.\n\n";
p_gate += "Verify summary: " + verify_summary + "\n";
p_gate += "Verify failures JSON: " + verify_failures + "\n";
p_gate += "Verify ok flag: " + verify_ok.to_string() + "\n\n";
p_gate += "Acceptance criteria from roadmap Phase 10 — each PASS or BLOCKING:\n";
p_gate += "A1) concurrent duplicate deliveries do not execute the same handler concurrently.\n";
p_gate += "    Evidence: concurrent test with handler call counter === 1 while second gets already_processing/duplicate.\n";
p_gate += "A2) completed events do not execute again.\n";
p_gate += "    Evidence: second process → duplicate_completed; handler call count unchanged.\n";
p_gate += "A3) expired leases can be reclaimed.\n";
p_gate += "    Evidence: fake clock advance + claim/process acquires again.\n";
p_gate += "A4) stale workers cannot complete reclaimed work.\n";
p_gate += "    Evidence: old leaseToken complete rejected after reclaim.\n";
p_gate += "A5) conflicting payloads are reported.\n";
p_gate += "    Evidence: payload_conflict outcome; handler not run.\n";
p_gate += "A6) inline and durable retry modes are explicit.\n";
p_gate += "    Evidence: mode option required/explicit; different failure outcomes per mode; docs.\n\n";
p_gate += "Also require Phase 10 sections 10.1-10.6 deliverables:\n";
p_gate += "- 10.1 processing model engine steps\n";
p_gate += "- 10.2 inbox record / no raw secrets storage\n";
p_gate += "- 10.3 modes explicit\n";
p_gate += "- 10.4 WebhookProcessingOutcome exact set\n";
p_gate += "- 10.5 lease renewal fails when stale\n";
p_gate += "- 10.6 crash boundaries documented AND tested\n";
p_gate += "- Package @paykernel/webhooks portable, depends on core only\n";
p_gate += "- Phase 0-9 safety net still green; boundaries; no core→webhooks; no webhooks→testkit\n";
p_gate += "- No Phase 11 adapter packages\n";
p_gate += "- No logical bugs: silent ACK of failures; get/set claim race in engine;\n";
p_gate += "  secrets in lastError; modes mixed implicitly; complete without lease token;\n";
p_gate += "  handler re-run on completed; stale complete succeeds.\n\n";
p_gate += "Independently re-run: bun test packages/core packages/testkit packages/webhooks;\n";
p_gate += "bun run typecheck; check:boundaries; focused webhooks tests; validate:package if time.\n";
p_gate += "If verify_ok is false, pass must be false unless you independently prove all green.\n";
p_gate += "Write report to packages/webhooks/docs/phase-10-gate-report.md\n";
p_gate += "AND packages/core/docs/baseline/phase-10-gate-report.md (full or pointer + verdict summary).\n";
p_gate += "Return pass, blocking[], non_blocking[], checklist[], summary, report_path.\n";

let gate = agent(p_gate, #{
    label: "gate:phase10-adversarial",
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
    write_scratch_file("phase10-gate.json", json_encode(gate.output));
} else {
    log("Gate agent failed — treating as fail");
}

// ─── Remediate ───────────────────────────────────────────────────
if !gate_pass {
    phase("Remediate");
    log("Remediating blocking gate items");
    let p_fix = "";
    p_fix += "Phase 10 gate FAILED for " + root + ".\n";
    p_fix += "Gate summary: " + gate_summary + "\n";
    p_fix += "Blocking items JSON: " + blocking_json + "\n";
    p_fix += "Verify summary: " + verify_summary + "\n";
    p_fix += "Verify failures: " + verify_failures + "\n\n";
    p_fix += "Fix ALL blocking items. Still Phase 10 only — no Phase 11 adapters, no reconciliation package.\n";
    p_fix += "Do NOT commit. Do NOT publish.\n";
    p_fix += "Complete @paykernel/webhooks engine, modes, outcomes, lease renewal, crash tests, docs, monorepo wiring as needed.\n";
    p_fix += "After fixes re-run:\n";
    p_fix += "  bun install\n";
    p_fix += "  bun run typecheck && bun run typecheck:types\n";
    p_fix += "  bun test packages/core packages/testkit packages/webhooks\n";
    p_fix += "  bun test --coverage packages/core\n";
    p_fix += "  bun run build && bun run check:boundaries && bun run check:runtime-portability\n";
    p_fix += "  bun run validate:package\n";
    p_fix += "Return {ok, fixed, remaining, summary}.\n";

    let fix = agent(p_fix, #{
        label: "remediate:phase10-blocking",
        capability_mode: "all",
        output_schema: fix_schema,
    });

    if fix != () && fix.success && fix.output != () {
        log("Remediate: " + fix.output.summary);
    }

    let p_re = "";
    p_re += "Re-verify Phase 10 after remediation in " + root + ".\n";
    p_re += "Run typecheck, typecheck:types, bun test packages/core packages/testkit packages/webhooks,\n";
    p_re += "coverage, build, boundaries, runtime-portability, validate:package.\n";
    p_re += "Confirm all 10.1-10.6 deliverables and acceptance criteria A1-A6 with command evidence.\n";
    p_re += "Return verify_schema; ok=true only if everything passes.\n";
    let re = agent(p_re, #{
        label: "verify:phase10-post-remediate",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if re != () && re.success && re.output != () {
        verify_ok = re.output.ok == true;
        verify_summary = re.output.summary;
        log("Post-remediate verify ok=" + verify_ok.to_string());
        write_scratch_file("phase10-verify-post.json", json_encode(re.output));
    }

    let p_gate2 = "";
    p_gate2 += "Final adversarial gate after remediation for Phase 10 at " + root + ".\n";
    p_gate2 += "Fail closed. Re-check A1-A6 acceptance criteria with independent evidence.\n";
    p_gate2 += "Update packages/webhooks/docs/phase-10-gate-report.md and packages/core/docs/baseline/phase-10-gate-report.md.\n";
    p_gate2 += "pass=true only if all acceptance criteria and 10.1-10.6 deliverables are evidenced.\n";
    p_gate2 += "Return gate_schema.\n";
    let gate2 = agent(p_gate2, #{
        label: "gate:phase10-final",
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
        write_scratch_file("phase10-gate-final.json", json_encode(gate2.output));
    }
}

// ─── Complete ────────────────────────────────────────────────────
let result_summary = "";
result_summary += "Phase 10 workflow complete. gate_pass=" + gate_pass.to_string();
result_summary += " verify_ok=" + verify_ok.to_string();
result_summary += " gate_summary=" + gate_summary;
result_summary += " verify_summary=" + verify_summary;

complete(#{
    phase: 10,
    gate_pass: gate_pass,
    verify_ok: verify_ok,
    gate_summary: gate_summary,
    verify_summary: verify_summary,
    blocking: blocking_json,
    summary: result_summary,
});
