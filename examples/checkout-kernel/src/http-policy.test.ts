import { describe, expect, it } from "bun:test";
import type { WebhookProcessingOutcome } from "@paykernel/webhooks";
import { mapInboxOutcome } from "./http-policy";

describe("mapInboxOutcome", () => {
  const cases: Array<[string, WebhookProcessingOutcome, number]> = [
    ["processed_maps_to_200", { outcome: "processed" }, 200],
    ["duplicate_completed_maps_to_200", { outcome: "duplicate_completed" }, 200],
    ["invalid_webhook_maps_to_400", { outcome: "invalid_webhook" }, 400],
    ["payload_conflict_maps_to_409", { outcome: "payload_conflict" }, 409],
    ["already_processing_maps_to_503", { outcome: "already_processing" }, 503],
    [
      "retryable_handler_failed_maps_to_500",
      { outcome: "handler_failed", retryable: true },
      500,
    ],
    [
      "nonretryable_handler_failed_maps_to_200",
      { outcome: "handler_failed", retryable: false },
      200,
    ],
    [
      "scheduled_not_available_maps_to_503",
      { outcome: "scheduled_for_retry", reason: "not_available" },
      503,
    ],
    [
      "scheduled_parked_maps_to_503",
      { outcome: "scheduled_for_retry", reason: "parked" },
      503,
    ],
    [
      "scheduled_handler_retry_maps_to_503",
      { outcome: "scheduled_for_retry", reason: "handler_retry" },
      503,
    ],
  ];

  it.each(cases)("%s", (_name, outcome, status) => {
    expect(mapInboxOutcome(outcome)).toBe(status);
  });
});
