import type { WebhookProcessingOutcome } from "@paykernel/webhooks";

export type InboxHttpAckPolicy =
  | { kind: "provider_redelivery" }
  | { kind: "durable_worker" };

export function mapInboxOutcome(
  outcome: WebhookProcessingOutcome,
  policy: InboxHttpAckPolicy = { kind: "provider_redelivery" },
): number {
  switch (outcome.outcome) {
    case "processed":
      return 200;
    case "duplicate_completed":
      return 200;
    case "invalid_webhook":
      return 400;
    case "payload_conflict":
      return 409;
    case "already_processing":
      return 503;
    case "handler_failed":
      return outcome.retryable ? 500 : 200;
    case "scheduled_for_retry": {
      if (outcome.reason === "not_available") {
        return 503;
      }
      // parked | handler_retry
      if (policy.kind === "durable_worker") {
        return 200;
      }
      return 503;
    }
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export function retryAfterSeconds(
  outcome: WebhookProcessingOutcome,
): number | undefined {
  const retryAfterMs =
    outcome.outcome === "already_processing" ||
    outcome.outcome === "scheduled_for_retry"
      ? outcome.retryAfterMs
      : undefined;
  if (retryAfterMs === undefined) return undefined;
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}
