import { describe, expect, it } from "bun:test";
import { NetworkError } from "@paykernel/core";
import { assertTapSuccessBody, mapTapHttpFailure } from "./http";

describe("assertTapSuccessBody", () => {
  it.each([
    ["empty", { responseText: "", jsonParseFailed: false, data: {} }],
    ["non-JSON", { responseText: "<html>", jsonParseFailed: true, data: {} }],
    ["null JSON", { responseText: "null", jsonParseFailed: false, data: null }],
    ["array JSON", { responseText: "[]", jsonParseFailed: false, data: [] }],
    [
      "object without id",
      {
        responseText: "{}",
        jsonParseFailed: false,
        data: { object: "charge" },
      },
    ],
  ] as const)("tags mutating 2xx %s as afterProviderSubmit", (_label, body) => {
    try {
      assertTapSuccessBody({
        method: "POST",
        status: 200,
        ...body,
      });
      expect.unreachable("unusable mutating 2xx must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).afterProviderSubmit).toBe(true);
    }
  });

  it("GET empty 2xx is NetworkError without afterProviderSubmit", () => {
    try {
      assertTapSuccessBody({
        method: "GET",
        status: 200,
        responseText: "",
        jsonParseFailed: false,
        data: {},
      });
      expect.unreachable("empty GET body must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).afterProviderSubmit).not.toBe(true);
    }
  });

  it("accepts a mutating 2xx object with id", () => {
    expect(() =>
      assertTapSuccessBody({
        method: "POST",
        status: 200,
        responseText: '{"id":"chg_1"}',
        jsonParseFailed: false,
        data: { id: "chg_1" },
      }),
    ).not.toThrow();
  });
});

describe("mapTapHttpFailure", () => {
  it("tags mutating 5xx NetworkError even when the body is not JSON", () => {
    const error = mapTapHttpFailure({
      status: 500,
      body: { body: "<html>upstream</html>" },
      method: "POST",
    });
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).afterProviderSubmit).toBe(true);
  });

  it("does not tag GET 5xx as afterProviderSubmit", () => {
    const error = mapTapHttpFailure({
      status: 500,
      body: { body: "<html>upstream</html>" },
      method: "GET",
    });
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).afterProviderSubmit).not.toBe(true);
  });
});
