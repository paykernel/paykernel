import { describe, it, expect } from "bun:test";
import * as hono from "./index";

describe("public API", () => {
  it("exports honoWebhook and re-exports integration-http", () => {
    expect(typeof hono.honoWebhook).toBe("function");
    expect(typeof hono.mapInboxOutcome).toBe("function");
    expect(typeof hono.processWebhookHttp).toBe("function");
    expect(typeof hono.requireStringBindings).toBe("function");
  });
});
