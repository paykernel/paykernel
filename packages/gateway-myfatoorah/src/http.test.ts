import { describe, expect, it } from "bun:test";
import {
  AuthenticationError,
  GatewayApiError,
  InvalidRequestError,
  NetworkError,
  RateLimitError,
  ResourceNotFoundError,
} from "@paykernel/core";
import {
  assertMyFatoorahSuccessEnvelope,
  mapMyFatoorahHttpFailure,
  myFatoorahIsSuccess,
} from "./http";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    IsSuccess: true,
    Message: "Ok",
    ValidationErrors: null,
    Data: { InvoiceId: 1 },
    ...overrides,
  };
}

describe("myfatoorah HTTP mapping", () => {
  it("treats IsSuccess true as success (boolean and string forms)", () => {
    expect(myFatoorahIsSuccess({ IsSuccess: true })).toBe(true);
    expect(myFatoorahIsSuccess({ IsSuccess: "true" })).toBe(true);
    expect(myFatoorahIsSuccess({ IsSuccess: "True" })).toBe(true);
    expect(myFatoorahIsSuccess({ IsSuccess: false })).toBe(false);
    expect(myFatoorahIsSuccess({ IsSuccess: "false" })).toBe(false);
    expect(myFatoorahIsSuccess(null)).toBe(false);
  });

  it("maps 2xx IsSuccess false + ValidationErrors to InvalidRequestError", () => {
    const body = envelope({
      IsSuccess: false,
      Message: "Validation failed",
      ValidationErrors: [
        { Name: "Amount", Error: "Amount is not valid" },
        { Name: "Currency", Error: "Currency is required" },
      ],
    });
    expect(() =>
      assertMyFatoorahSuccessEnvelope({
        method: "POST",
        status: 200,
        responseText: JSON.stringify(body),
        jsonParseFailed: false,
        data: body,
      }),
    ).toThrow(InvalidRequestError);
  });

  it("maps POST 500 to NetworkError with afterProviderSubmit", () => {
    const error = mapMyFatoorahHttpFailure({
      status: 500,
      body: { IsSuccess: false, Message: "boom" },
      method: "POST",
    });
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).afterProviderSubmit).toBe(true);
  });

  it("maps GET 500 to NetworkError without afterProviderSubmit", () => {
    const error = mapMyFatoorahHttpFailure({
      status: 503,
      body: {},
      method: "GET",
    });
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).afterProviderSubmit).toBe(false);
  });

  it("maps 401 / 403 to AuthenticationError", () => {
    expect(mapMyFatoorahHttpFailure({ status: 401, body: {}, method: "POST" })).toBeInstanceOf(
      AuthenticationError,
    );
    expect(mapMyFatoorahHttpFailure({ status: 403, body: {}, method: "POST" })).toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("maps 404 to ResourceNotFoundError", () => {
    expect(mapMyFatoorahHttpFailure({ status: 404, body: {}, method: "POST" })).toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it("maps 429 to RateLimitError", () => {
    expect(mapMyFatoorahHttpFailure({ status: 429, body: {}, method: "POST" })).toBeInstanceOf(
      RateLimitError,
    );
    const error = mapMyFatoorahHttpFailure({
      status: 429,
      body: {},
      method: "POST",
      headers: new Headers({ "retry-after": "7" }),
    });
    expect((error as RateLimitError).retryAfterSeconds).toBe(7);
  });

  it("maps IsSuccess false with ValidationErrors on non-2xx to InvalidRequestError", () => {
    const error = mapMyFatoorahHttpFailure({
      status: 400,
      body: {
        IsSuccess: false,
        ValidationErrors: [{ Name: "Key", Error: "Key is invalid" }],
      },
      method: "POST",
    });
    expect(error).toBeInstanceOf(InvalidRequestError);
  });

  it("maps unknown client failures to GatewayApiError", () => {
    const error = mapMyFatoorahHttpFailure({
      status: 400,
      body: { IsSuccess: false, Message: "Something" },
      method: "POST",
    });
    expect(error).toBeInstanceOf(GatewayApiError);
  });

  it("rejects unusable 2xx bodies as NetworkError", () => {
    expect(() =>
      assertMyFatoorahSuccessEnvelope({
        method: "POST",
        status: 200,
        responseText: "",
        jsonParseFailed: false,
        data: {},
      }),
    ).toThrow(NetworkError);
    expect(() =>
      assertMyFatoorahSuccessEnvelope({
        method: "POST",
        status: 200,
        responseText: "<html>",
        jsonParseFailed: true,
        data: {},
      }),
    ).toThrow(NetworkError);
  });
});
