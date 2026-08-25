import { mapInboxOutcome } from "./http-policy";
import type { WebhookProcessingOutcome } from "@paykernel/webhooks";

// Assignability: every outcome variant is accepted
const outcomes: WebhookProcessingOutcome[] = [
  { outcome: "processed" },
  { outcome: "duplicate_completed" },
  { outcome: "already_processing" },
  { outcome: "already_processing", retryAfterMs: 1000 },
  { outcome: "scheduled_for_retry", reason: "parked" },
  { outcome: "scheduled_for_retry", reason: "handler_retry" },
  { outcome: "scheduled_for_retry", reason: "not_available" },
  { outcome: "handler_failed", retryable: true },
  { outcome: "handler_failed", retryable: false },
  { outcome: "payload_conflict" },
  { outcome: "invalid_webhook" },
  { outcome: "invalid_webhook", reason: "forgery" },
];

for (const o of outcomes) {
  mapInboxOutcome(o);
  mapInboxOutcome(o, { kind: "durable_worker" });
}
