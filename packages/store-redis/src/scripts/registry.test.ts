import { describe, expect, it } from "bun:test";
import { REDIS_SCRIPT_REGISTRY } from "./index";

describe("REDIS_SCRIPT_REGISTRY", () => {
  it("includes all correctness-critical transitions", () => {
    expect(REDIS_SCRIPT_REGISTRY.idempotency.reserve).toContain("redis.call");
    expect(REDIS_SCRIPT_REGISTRY.idempotency.renew).toContain("generation");
    expect(REDIS_SCRIPT_REGISTRY.idempotency.complete).toContain("completed");
    expect(REDIS_SCRIPT_REGISTRY.idempotency.markIndeterminate).toContain(
      "indeterminate",
    );

    expect(REDIS_SCRIPT_REGISTRY.webhookInbox.claim).toContain("payload_hash");
    expect(REDIS_SCRIPT_REGISTRY.webhookInbox.claim).toContain("ifMatchPayloadHash");
    expect(REDIS_SCRIPT_REGISTRY.webhookInbox.fail).toContain("dead_letter");

    expect(REDIS_SCRIPT_REGISTRY.reconciliation.schedule).toContain("scheduled");
    expect(REDIS_SCRIPT_REGISTRY.reconciliation.claim).toContain("acquired");
    expect(REDIS_SCRIPT_REGISTRY.reconciliation.markManualReview).toContain(
      "manual_review",
    );
  });

  it("scripts accept now via ARGV not sole TIME", () => {
    // Critical reclaim paths use tonumber(ARGV[1]) for nowMs
    expect(REDIS_SCRIPT_REGISTRY.idempotency.reserve).toContain("ARGV[1]");
    expect(REDIS_SCRIPT_REGISTRY.idempotency.reserve).toContain("nowMs");
    // Must not hardcode redis.call('TIME') as sole lease source
    expect(REDIS_SCRIPT_REGISTRY.idempotency.reserve.includes("redis.call('TIME')")).toBe(
      false,
    );
  });

  it("scripts return tagged outcomes", () => {
    expect(REDIS_SCRIPT_REGISTRY.idempotency.reserve).toContain("'acquired'");
    expect(REDIS_SCRIPT_REGISTRY.idempotency.reserve).toContain(
      "'fingerprint_conflict'",
    );
    expect(REDIS_SCRIPT_REGISTRY.idempotency.reserve).toContain("'indeterminate'");
  });

  it("idempotency complete never EXPIREs completed fences (REDIS-1)", () => {
    const complete = REDIS_SCRIPT_REGISTRY.idempotency.complete;
    // Must not call Redis EXPIRE after status=completed (re-reserve after eviction).
    // Avoid matching field names like lease_expires_ms.
    expect(complete).not.toMatch(/redis\.call\(\s*['"]EXPIRE['"]/i);
    // PERSIST clears any prior TTL so the fence cannot silently re-open.
    expect(complete).toMatch(/redis\.call\(\s*['"]PERSIST['"]/i);
    expect(complete).toContain("'completed'");
    // reserve still treats completed as already_completed
    expect(REDIS_SCRIPT_REGISTRY.idempotency.reserve).toContain(
      "'already_completed'",
    );
  });

  it("STORES-5: webhook/recon complete, dead_letter, terminal fail, manual_review never EXPIRE", () => {
    const scripts = [
      REDIS_SCRIPT_REGISTRY.webhookInbox.complete,
      REDIS_SCRIPT_REGISTRY.webhookInbox.fail,
      REDIS_SCRIPT_REGISTRY.reconciliation.complete,
      REDIS_SCRIPT_REGISTRY.reconciliation.fail,
      REDIS_SCRIPT_REGISTRY.reconciliation.markManualReview,
    ];
    for (const script of scripts) {
      expect(script).not.toMatch(/redis\.call\(\s*['"]EXPIRE['"]/i);
      expect(script).toMatch(/redis\.call\(\s*['"]PERSIST['"]/i);
    }
    expect(REDIS_SCRIPT_REGISTRY.webhookInbox.complete).toContain("'completed'");
    expect(REDIS_SCRIPT_REGISTRY.webhookInbox.fail).toContain("dead_letter");
    expect(REDIS_SCRIPT_REGISTRY.reconciliation.fail).toContain("'failed'");
    expect(REDIS_SCRIPT_REGISTRY.reconciliation.markManualReview).toContain(
      "manual_review",
    );
  });

  it("webhook fail accepts matching token after expiry (WEBHOOKS-2; complete still fences)", () => {
    const fail = REDIS_SCRIPT_REGISTRY.webhookInbox.fail;
    const complete = REDIS_SCRIPT_REGISTRY.webhookInbox.complete;
    expect(fail).toContain("lease_lost");
    expect(fail).toContain("lease_token");
    // WEBHOOKS-2: hang/timeout handlers record attempts after lease expiry.
    // Complete remains fenced on unexpired lease (side-effect commit boundary).
    expect(fail).not.toContain("exp <= nowMs");
    expect(complete).toContain("exp <= nowMs");
  });

  // Offline source-contract smoke (no Redis): behavioral coverage is in
  // stores.mock.test.ts + integration.redis.test.ts when live Redis is set.
  it("webhook claim script encodes available_ms backoff and recovery reclaim", () => {
    const claim = REDIS_SCRIPT_REGISTRY.webhookInbox.claim;
    expect(claim).toContain("not_available");
    expect(claim).toContain("available_ms");
    expect(claim).toContain("expired lease");
    // WEBHOOKS-1: only pending burns attempts on reclaim
    expect(claim).toContain("status == 'pending'");
    expect(claim).toMatch(/if status == 'pending'/);
  });

  it("S19-CLOCK-LEASE: webhook GET does not wipe leases; list GET still soft-releases", () => {
    const get = REDIS_SCRIPT_REGISTRY.webhookInbox.get;
    const listGet = REDIS_SCRIPT_REGISTRY.webhookInbox.listGet;
    expect(get).not.toMatch(/redis\.call\(\s*['"]HSET['"]/i);
    expect(get).not.toMatch(/attempts\s*=\s*attempts\s*-\s*1|attempts - 1/);
    expect(listGet).toMatch(/attempts\s*=\s*attempts\s*-\s*1|attempts - 1/);
    expect(listGet).toMatch(/redis\.call\(\s*['"]HSET['"]/i);
    expect(listGet).toContain("'lease_token', ''");
  });

  it("webhook fail script encodes restoreAttempt parking decrement", () => {
    const fail = REDIS_SCRIPT_REGISTRY.webhookInbox.fail;
    expect(fail).toContain("restoreAttempt");
    expect(fail).toMatch(/attempts\s*=\s*math\.max/);
  });


  it("recon fail accepts matching token after expiry (RECON-LEASE-1; complete still fences)", () => {
    const fail = REDIS_SCRIPT_REGISTRY.reconciliation.fail;
    const complete = REDIS_SCRIPT_REGISTRY.reconciliation.complete;
    expect(fail).toContain("lease_lost");
    expect(fail).toContain("lease_token");
    // RECON-LEASE-1: hang/timeout records retry/dead-letter after lease expiry.
    expect(fail).not.toContain("exp <= nowMs");
    expect(complete).toContain("exp <= nowMs");
  });


  it("recon markManualReview accepts matching token after expiry (RECON-LEASE-1)", () => {
    const mark = REDIS_SCRIPT_REGISTRY.reconciliation.markManualReview;
    const complete = REDIS_SCRIPT_REGISTRY.reconciliation.complete;
    expect(mark).toContain("lease_lost");
    expect(mark).toContain("lease_token");
    expect(mark).not.toContain("exp <= nowMs");
    expect(complete).toContain("exp <= nowMs");
  });

  it("P19-REOPEN: recon schedule reopens only terminal statuses", () => {
    const schedule = REDIS_SCRIPT_REGISTRY.reconciliation.schedule;
    expect(schedule).toMatch(/status == 'completed'/);
    expect(schedule).toMatch(/status == 'failed'/);
    expect(schedule).toMatch(/status == 'manual_review'/);
    expect(schedule).toContain("'scheduled'");
    expect(schedule).toMatch(/already_exists/);
  });

  it("P1315-REDIS-1: recon claim increments attempts only when scheduled", () => {
    const claim = REDIS_SCRIPT_REGISTRY.reconciliation.claim;
    // Must not unconditionally increment (expired claimed reclaim keeps attempts).
    expect(claim).not.toMatch(
      /local attempts = \(tonumber\(m\['attempts'\] or '0'\) or 0\) \+ 1/,
    );
    expect(claim).toMatch(/if status == 'scheduled'/);
    expect(claim).toContain("prevAttempts");
  });

  it("S19-CLOCK-LEASE: recon GET does not wipe leases; list GET still soft-releases", () => {
    const get = REDIS_SCRIPT_REGISTRY.reconciliation.get;
    const listGet = REDIS_SCRIPT_REGISTRY.reconciliation.listGet;
    expect(get).not.toMatch(/redis\.call\(\s*['"]HSET['"]/i);
    expect(get).not.toMatch(/attempts\s*=\s*attempts\s*-\s*1|attempts - 1/);
    expect(listGet).toMatch(/attempts\s*=\s*attempts\s*-\s*1|attempts - 1/);
    expect(listGet).toMatch(/redis\.call\(\s*['"]HSET['"]/i);
    expect(listGet).toContain("'lease_token', ''");
  });

  it("NEW-STORE-1: GET Lua ZREMs ghost index members when hash is missing", () => {
    // listDue / listRetryable is ZRANGE + list GET. A missing hash must drop
    // the ZSET member (listedKey) so LIMIT windows cannot fill with dead keys.
    for (const get of [
      REDIS_SCRIPT_REGISTRY.webhookInbox.get,
      REDIS_SCRIPT_REGISTRY.reconciliation.get,
      REDIS_SCRIPT_REGISTRY.webhookInbox.listGet,
      REDIS_SCRIPT_REGISTRY.reconciliation.listGet,
    ]) {
      const exists = get.search(/EXISTS',\s*rec\)\s*==\s*0/);
      const zrem = get.search(/redis\.call\(\s*['"]ZREM['"]\s*,\s*idx/);
      const missing = get.indexOf("'missing'");
      expect(exists).toBeGreaterThan(-1);
      expect(zrem).toBeGreaterThan(exists);
      expect(missing).toBeGreaterThan(zrem);
      expect(get).toContain("listedKey");
    }
  });

  it("PERF-4: list GET scripts load a ZRANGE page in one EVAL", () => {
    for (const listGet of [
      REDIS_SCRIPT_REGISTRY.webhookInbox.listGet,
      REDIS_SCRIPT_REGISTRY.reconciliation.listGet,
    ]) {
      expect(listGet).toContain("for i = 2, #KEYS");
      expect(listGet).toContain("ARGV[i + 1]");
    }
  });

  it("REDIS-1: renew Lua rescored the due/retry index at leaseExpiresMs", () => {
    const recon = REDIS_SCRIPT_REGISTRY.reconciliation.renew;
    const webhook = REDIS_SCRIPT_REGISTRY.webhookInbox.renew;
    for (const renew of [recon, webhook]) {
      expect(renew).toContain("ZADD");
      expect(renew).toContain("leaseExpiresMs");
    }
  });

  it("P1315-REDIS-2: claim ZADDs due/retry index at lease expiry (not ZREM)", () => {
    const recon = REDIS_SCRIPT_REGISTRY.reconciliation.claim;
    const webhook = REDIS_SCRIPT_REGISTRY.webhookInbox.claim;
    for (const claim of [recon, webhook]) {
      expect(claim).toMatch(
        /redis\.call\(\s*['"]ZADD['"]\s*,\s*idx\s*,\s*tonumber\(leaseExpiresMs\)/,
      );
      expect(claim).not.toMatch(/redis\.call\(\s*['"]ZREM['"]/);
    }
    // Terminal paths still ZREM so completed/failed work leaves the index.
    expect(REDIS_SCRIPT_REGISTRY.reconciliation.complete).toMatch(
      /redis\.call\(\s*['"]ZREM['"]/,
    );
    expect(REDIS_SCRIPT_REGISTRY.reconciliation.fail).toMatch(
      /redis\.call\(\s*['"]ZREM['"]/,
    );
    expect(REDIS_SCRIPT_REGISTRY.webhookInbox.complete).toMatch(
      /redis\.call\(\s*['"]ZREM['"]/,
    );
    expect(REDIS_SCRIPT_REGISTRY.webhookInbox.fail).toMatch(
      /redis\.call\(\s*['"]ZREM['"]/,
    );
  });

  it("P1315-REDIS-4: reserve classifies completed then indeterminate then fingerprint", () => {
    const reserve = REDIS_SCRIPT_REGISTRY.idempotency.reserve;
    const completed = reserve.indexOf("status == 'completed'");
    const indeterminate = reserve.indexOf("status == 'indeterminate'");
    const fp = reserve.indexOf("fp ~= fingerprint");
    expect(completed).toBeGreaterThan(-1);
    expect(indeterminate).toBeGreaterThan(completed);
    expect(fp).toBeGreaterThan(indeterminate);
  });

});
