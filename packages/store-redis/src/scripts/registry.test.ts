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
});
