import { describe, expect, it } from "bun:test";
import { money, MoneyAmountError } from "@paykernel/core";
import {
  formatTapIsoAmount,
  parseTapAmount,
  stringifyTapJsonBody,
  tapMajorNumber,
} from "./money";

describe("formatTapIsoAmount", () => {
  it("pads SAR to two fractional digits", () => {
    expect(formatTapIsoAmount(money("1", "SAR"), "SAR")).toBe("1.00");
    expect(formatTapIsoAmount(1, "SAR")).toBe("1.00");
  });

  it("pads KWD to three fractional digits", () => {
    expect(formatTapIsoAmount(money("1.2", "KWD"), "KWD")).toBe("1.200");
  });

  it("rejects excess precision", () => {
    expect(() => formatTapIsoAmount("1.234", "SAR")).toThrow(MoneyAmountError);
  });
});

describe("tapMajorNumber", () => {
  it("returns a finite major number after Money round-trip", () => {
    expect(tapMajorNumber(money("10.50", "SAR"), "SAR")).toBe(10.5);
  });
});

describe("stringifyTapJsonBody", () => {
  it("emits an ISO-padded JSON number token, not a string", () => {
    const raw = stringifyTapJsonBody({
      amount: 10.5,
      currency: "SAR",
      source: { id: "src_all" },
    });
    expect(raw).toContain('"amount":10.50');
    expect(raw).not.toContain('"amount":"10.50"');
    expect(raw).toContain('"amount":10.50,"currency":"SAR"');
    const parsed = JSON.parse(raw) as { amount: unknown };
    expect(parsed.amount).toBe(10.5);
  });

  it("pads KWD to three fractional digits on the wire", () => {
    const raw = stringifyTapJsonBody({ amount: 1.2, currency: "KWD" });
    expect(raw).toContain('"amount":1.200');
    expect(JSON.parse(raw).amount).toBe(1.2);
  });

  it("stringifies unchanged when amount or currency is missing", () => {
    expect(stringifyTapJsonBody({ currency: "SAR" })).toBe('{"currency":"SAR"}');
    expect(stringifyTapJsonBody({ amount: 10.5 })).toBe('{"amount":10.5}');
  });

  it("does not replace a placeholder that appears in another string field", () => {
    const raw = stringifyTapJsonBody({
      description: "__paykernel_tap_iso_amount__",
      amount: 10.5,
      currency: "SAR",
    });
    expect(raw).toContain('"amount":10.50');
    expect(raw).toContain('"description":"__paykernel_tap_iso_amount__"');
    expect(JSON.parse(raw).amount).toBe(10.5);
  });
});

describe("parseTapAmount", () => {
  it("parses JSON numbers through Money", () => {
    expect(parseTapAmount(1, "SAR").amount).toBe("1.00");
    expect(parseTapAmount("1.200", "KWD").amount).toBe("1.200");
  });

  it("rejects non-numeric amounts", () => {
    expect(() => parseTapAmount({ n: 1 }, "SAR")).toThrow();
  });
});
