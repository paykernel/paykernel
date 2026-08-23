import { describe, expect, it } from "bun:test";
import { InvalidRequestError, money } from "@paykernel/core";
import {
  formatMyFatoorahIsoAmount,
  myFatoorahMajorNumber,
  parseMyFatoorahAmount,
  stringifyMyFatoorahJsonBody,
} from "./money";

describe("myfatoorah money", () => {
  it("ISO-pads major decimal strings", () => {
    expect(formatMyFatoorahIsoAmount(money("1", "SAR"), "SAR")).toBe("1.00");
    expect(formatMyFatoorahIsoAmount(money("1.2", "KWD"), "KWD")).toBe("1.200");
    expect(formatMyFatoorahIsoAmount(10.5, "SAR")).toBe("10.50");
  });

  it("rejects excess precision", () => {
    expect(() => formatMyFatoorahIsoAmount(1.2345, "KWD")).toThrow();
    expect(() => formatMyFatoorahIsoAmount(1.2345, "SAR")).toThrow();
  });

  it("parses provider amounts", () => {
    expect(parseMyFatoorahAmount(10.5, "SAR").amount).toBe("10.50");
    expect(parseMyFatoorahAmount("10.500", "KWD").amount).toBe("10.500");
    expect(() => parseMyFatoorahAmount(null, "SAR")).toThrow(InvalidRequestError);
  });

  it("converts to major number with reject rounding", () => {
    expect(myFatoorahMajorNumber(money("10.50", "SAR"), "SAR")).toBe(10.5);
    expect(myFatoorahMajorNumber(money("1.200", "KWD"), "KWD")).toBe(1.2);
  });

  it("serializes nested Order.Amount as an ISO-padded number token", () => {
    const body = {
      Order: { Amount: 1, Currency: "SAR" },
      IntegrationUrls: { Redirection: "https://merchant.example/return" },
    };
    const serialized = stringifyMyFatoorahJsonBody(body);
    expect(serialized).toContain('"Amount":1.00');
    expect(serialized).not.toContain('"Amount":"1.00"');
    expect(JSON.parse(serialized)).toEqual({
      Order: { Amount: 1, Currency: "SAR" },
      IntegrationUrls: { Redirection: "https://merchant.example/return" },
    });
  });

  it("serializes top-level Amount (MakeRefund) with the explicit currency", () => {
    const body = { KeyType: "InvoiceId", Key: "915102", Amount: 2.5 };
    const serialized = stringifyMyFatoorahJsonBody(body, "KWD");
    expect(serialized).toContain('"Amount":2.500');
    expect(serialized).not.toContain('"Amount":"2.500"');
  });

  it("leaves bodies without numeric amounts unchanged", () => {
    const body = { KeyType: "InvoiceId", Key: "915102" };
    expect(stringifyMyFatoorahJsonBody(body)).toBe(JSON.stringify(body));
  });
});
