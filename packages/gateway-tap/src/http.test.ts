import { describe, expect, it } from "bun:test";
import {
  CardDeclinedError,
  GatewayApiError,
  InvalidRequestError,
  NetworkError,
  ResourceNotFoundError,
} from "@paykernel/core";
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

  it("treats POST 400 code 1151 as NetworkError afterProviderSubmit", () => {
    const error = mapTapHttpFailure({
      status: 400,
      body: { errors: [{ code: 1151, description: "Request timed out" }] },
      method: "POST",
    });
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).afterProviderSubmit).toBe(true);
  });

  it("treats GET 400 code 1151 as NetworkError without afterProviderSubmit", () => {
    const error = mapTapHttpFailure({
      status: 400,
      body: { errors: [{ code: 1151 }] },
      method: "GET",
    });
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).afterProviderSubmit).not.toBe(true);
  });

  it("does not map POST 400 errors code 504 to CardDeclinedError", () => {
    const error = mapTapHttpFailure({
      status: 400,
      body: { errors: [{ code: 504, description: "Declined" }] },
      method: "POST",
    });
    expect(error).not.toBeInstanceOf(CardDeclinedError);
    expect(
      error instanceof GatewayApiError || error instanceof InvalidRequestError,
    ).toBe(true);
  });

  it("does not map POST 400 errors code 501 to CardDeclinedError", () => {
    const error = mapTapHttpFailure({
      status: 400,
      body: { errors: [{ code: 501 }] },
      method: "POST",
    });
    expect(error).not.toBeInstanceOf(CardDeclinedError);
    expect(
      error instanceof GatewayApiError || error instanceof InvalidRequestError,
    ).toBe(true);
  });

  it("maps POST 400 code 1106 to InvalidRequestError not ResourceNotFoundError", () => {
    const error = mapTapHttpFailure({
      status: 400,
      body: { errors: [{ code: 1106, description: "Customer not found" }] },
      method: "POST",
    });
    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error).not.toBeInstanceOf(ResourceNotFoundError);
  });

  it("maps GET 400 code 1106 to InvalidRequestError not ResourceNotFoundError", () => {
    const error = mapTapHttpFailure({
      status: 400,
      body: { errors: [{ code: 1106, description: "Customer not found" }] },
      method: "GET",
    });
    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error).not.toBeInstanceOf(ResourceNotFoundError);
  });

  it("maps POST 400 code 1114 to InvalidRequestError", () => {
    const error = mapTapHttpFailure({
      status: 400,
      body: {
        errors: [
          { code: 1114, description: "Please check the Authorize status" },
        ],
      },
      method: "POST",
    });
    expect(error).toBeInstanceOf(InvalidRequestError);
  });

  it("passes raw {status,body,code} on AMOUNT_CODES InvalidRequestError", () => {
    const body = { errors: [{ code: 1150, description: "Invalid amount" }] };
    const error = mapTapHttpFailure({
      status: 400,
      body,
      method: "POST",
    });
    expect(error).toBeInstanceOf(InvalidRequestError);
    expect((error as InvalidRequestError).validationErrors).toEqual([
      { status: 400, body, code: "1150" },
    ]);
  });

  it.each(["1144", "1115", "1160", "2102"] as const)(
    "maps POST 400 code %s to ResourceNotFoundError",
    (code) => {
      const error = mapTapHttpFailure({
        status: 400,
        body: { errors: [{ code }] },
        method: "POST",
      });
      expect(error).toBeInstanceOf(ResourceNotFoundError);
    },
  );
});
