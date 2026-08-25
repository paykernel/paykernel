import { describe, it, expect } from "bun:test";
import * as mod from "./index";

describe("public API", () => {
  it("exports workers helpers", () => {
    expect(typeof mod.handleCloudflareWebhook).toBe("function");
    expect(typeof mod.readWorkerBindings).toBe("function");
    expect(typeof mod.createCloudflareWebhookFetchHandler).toBe("function");
  });
});
