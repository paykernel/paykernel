/**
 * Public API surface — freezes runtime export names for @paykernel/webhooks.
 */
import { describe, it, expect } from "bun:test";
import * as webhooks from "./index";

describe("public API runtime surface", () => {
  it("re-exports every documented runtime symbol from the package root", () => {
    const runtimeExports: Array<[string, unknown]> = [
      ["createWebhookInboxEngine", webhooks.createWebhookInboxEngine],
      ["computePayloadHash", webhooks.computePayloadHash],
      ["deriveWebhookEventKey", webhooks.deriveWebhookEventKey],
      ["parseWebhookEventKey", webhooks.parseWebhookEventKey],
      ["sanitizeWebhookError", webhooks.sanitizeWebhookError],
      ["DEFAULT_SANITIZE_MAX_LENGTH", webhooks.DEFAULT_SANITIZE_MAX_LENGTH],
      ["StoreLeaseLostError", webhooks.StoreLeaseLostError],
      ["isStoreLeaseLostError", webhooks.isStoreLeaseLostError],
      ["NonRetryableHandlerError", webhooks.NonRetryableHandlerError],
    ];

    for (const [name, value] of runtimeExports) {
      expect(value, `missing export: ${name}`).toBeDefined();
      if (name === "createWebhookInboxEngine" || name === "computePayloadHash") {
        expect(typeof value).toBe("function");
      }
    }
  });

  it("does not export memory store on public surface", () => {
    expect(
      (webhooks as Record<string, unknown>).createMemoryWebhookInboxStore,
    ).toBeUndefined();
  });

  it("StoreLeaseLostError is constructible with code lease_lost", () => {
    const err = new webhooks.StoreLeaseLostError("test");
    expect(err.code).toBe("lease_lost");
    expect(webhooks.isStoreLeaseLostError(err)).toBe(true);
  });

  it("isStoreLeaseLostError matches name-based dual copies, not bare code", () => {
    const named = new Error("fencing");
    named.name = "StoreLeaseLostError";
    expect(webhooks.isStoreLeaseLostError(named)).toBe(true);

    // Domain / handler throws must not skip store.fail (WEBHOOKS-6).
    expect(
      webhooks.isStoreLeaseLostError({ code: "lease_lost", message: "nope" }),
    ).toBe(false);
    const domain = new Error("business lease lost");
    (domain as Error & { code: string }).code = "lease_lost";
    expect(webhooks.isStoreLeaseLostError(domain)).toBe(false);
  });
});
