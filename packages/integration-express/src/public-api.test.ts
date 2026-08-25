import { describe, it, expect } from "bun:test";
import * as mod from "./index";

describe("public API", () => {
  it("exports express helpers", () => {
    expect(typeof mod.expressRawJson).toBe("function");
    expect(typeof mod.expressWebhook).toBe("function");
    expect(typeof mod.mapInboxOutcome).toBe("function");
  });
});
