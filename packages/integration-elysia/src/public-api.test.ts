import { describe, it, expect } from "bun:test";
import * as elysia from "./index";

describe("public API", () => {
  it("exports elysiaWebhook and re-exports", () => {
    expect(typeof elysia.elysiaWebhook).toBe("function");
    expect(typeof elysia.mapInboxOutcome).toBe("function");
  });
});
