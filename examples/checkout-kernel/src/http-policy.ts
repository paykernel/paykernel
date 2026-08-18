/**
 * App-owned HTTP mapping for inbox outcomes.
 * `@paykernel/webhooks` never hardcodes status codes.
 */

import type { WebhookProcessingOutcome } from "@paykernel/webhooks";

/**
 * Map a framework-agnostic inbox outcome to an HTTP status.
 *
 * Exhaustive on {@link WebhookProcessingOutcome.outcome}.
 */
export function mapInboxOutcome(outcome: WebhookProcessingOutcome): number {
  switch (outcome.outcome) {
    case "processed":
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
    case "scheduled_for_retry":
      return outcome.reason === "not_available" ? 503 : 200;
  }
}
