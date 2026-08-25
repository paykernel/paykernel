import { describe, it, expect } from "bun:test";
import * as integrationHttp from "./index";

describe("public API runtime surface", () => {
  it("re-exports documented runtime symbols", () => {
    const runtimeExports: Array<[string, unknown]> = [
      ["mapInboxOutcome", integrationHttp.mapInboxOutcome],
      ["retryAfterSeconds", integrationHttp.retryAfterSeconds],
      ["getHeader", integrationHttp.getHeader],
      ["resolveCorrelationId", integrationHttp.resolveCorrelationId],
      ["requireStringBindings", integrationHttp.requireStringBindings],
      ["GATEWAY_WEBHOOK_SIGNATURE", integrationHttp.GATEWAY_WEBHOOK_SIGNATURE],
      ["extractWebhookSignature", integrationHttp.extractWebhookSignature],
      ["processWebhookHttp", integrationHttp.processWebhookHttp],
      ["webhookHttpResultToResponse", integrationHttp.webhookHttpResultToResponse],
      ["createWebhookOperationContext", integrationHttp.createWebhookOperationContext],
    ];

    const functionExports = new Set([
      "mapInboxOutcome",
      "retryAfterSeconds",
      "getHeader",
      "resolveCorrelationId",
      "requireStringBindings",
      "extractWebhookSignature",
      "processWebhookHttp",
      "webhookHttpResultToResponse",
      "createWebhookOperationContext",
    ]);

    for (const [name, value] of runtimeExports) {
      expect(value, `missing export: ${name}`).toBeDefined();
      if (functionExports.has(name)) {
        expect(typeof value).toBe("function");
      }
    }
  });
});
