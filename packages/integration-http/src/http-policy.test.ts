import { describe, it, expect } from "bun:test";
import { mapInboxOutcome, retryAfterSeconds, type InboxHttpAckPolicy } from "./http-policy";
import type { WebhookProcessingOutcome } from "@paykernel/webhooks";

describe("mapInboxOutcome", () => {
  const provider: InboxHttpAckPolicy = { kind: "provider_redelivery" };
  const durable: InboxHttpAckPolicy = { kind: "durable_worker" };

  it("maps processed and duplicate_completed to 200", () => {
    expect(mapInboxOutcome({ outcome: "processed" })).toBe(200);
    expect(mapInboxOutcome({ outcome: "duplicate_completed" })).toBe(200);
    expect(mapInboxOutcome({ outcome: "processed" }, durable)).toBe(200);
    expect(mapInboxOutcome({ outcome: "duplicate_completed" }, durable)).toBe(200);
  });

  it("maps invalid_webhook to 400", () => {
    expect(mapInboxOutcome({ outcome: "invalid_webhook" })).toBe(400);
    expect(mapInboxOutcome({ outcome: "invalid_webhook", reason: "forgery" }, durable)).toBe(400);
  });

  it("maps payload_conflict to 409", () => {
    expect(mapInboxOutcome({ outcome: "payload_conflict" })).toBe(409);
    expect(mapInboxOutcome({ outcome: "payload_conflict" }, durable)).toBe(409);
  });

  it("maps already_processing to 503 regardless of policy", () => {
    expect(mapInboxOutcome({ outcome: "already_processing" })).toBe(503);
    expect(mapInboxOutcome({ outcome: "already_processing", retryAfterMs: 5000 }, durable)).toBe(503);
  });

  it("maps handler_failed retryable to 500 and non-retryable to 200", () => {
    expect(mapInboxOutcome({ outcome: "handler_failed", retryable: true })).toBe(500);
    expect(mapInboxOutcome({ outcome: "handler_failed", retryable: false })).toBe(200);
    expect(mapInboxOutcome({ outcome: "handler_failed", retryable: true }, durable)).toBe(500);
    expect(mapInboxOutcome({ outcome: "handler_failed", retryable: false }, durable)).toBe(200);
  });

  it("maps scheduled_for_retry not_available to 503 in both policies", () => {
    const outcome: WebhookProcessingOutcome = { outcome: "scheduled_for_retry", reason: "not_available" };
    expect(mapInboxOutcome(outcome)).toBe(503);
    expect(mapInboxOutcome(outcome, durable)).toBe(503);
  });

  it("maps scheduled_for_retry parked and handler_retry to 503 default and 200 durable", () => {
    const parked: WebhookProcessingOutcome = { outcome: "scheduled_for_retry", reason: "parked" };
    const handlerRetry: WebhookProcessingOutcome = { outcome: "scheduled_for_retry", reason: "handler_retry" };
    expect(mapInboxOutcome(parked)).toBe(503);
    expect(mapInboxOutcome(handlerRetry)).toBe(503);
    expect(mapInboxOutcome(parked, durable)).toBe(200);
    expect(mapInboxOutcome(handlerRetry, durable)).toBe(200);
  });

  it("defaults to provider_redelivery when policy omitted", () => {
    const parked: WebhookProcessingOutcome = { outcome: "scheduled_for_retry", reason: "parked" };
    expect(mapInboxOutcome(parked)).toBe(503);
    expect(mapInboxOutcome(parked, undefined)).toBe(503);
  });
});

describe("retryAfterSeconds", () => {
  it("returns undefined when retryAfterMs absent", () => {
    expect(retryAfterSeconds({ outcome: "processed" })).toBeUndefined();
    expect(retryAfterSeconds({ outcome: "already_processing" })).toBeUndefined();
    expect(retryAfterSeconds({ outcome: "scheduled_for_retry", reason: "parked" })).toBeUndefined();
  });

  it("ceil ms to seconds at least 1", () => {
    expect(retryAfterSeconds({ outcome: "already_processing", retryAfterMs: 1 })).toBe(1);
    expect(retryAfterSeconds({ outcome: "already_processing", retryAfterMs: 1000 })).toBe(1);
    expect(retryAfterSeconds({ outcome: "already_processing", retryAfterMs: 1001 })).toBe(2);
    expect(retryAfterSeconds({ outcome: "scheduled_for_retry", reason: "not_available", retryAfterMs: 5000 })).toBe(5);
    expect(retryAfterSeconds({ outcome: "scheduled_for_retry", reason: "handler_retry", retryAfterMs: 0 })).toBe(1);
  });
});
