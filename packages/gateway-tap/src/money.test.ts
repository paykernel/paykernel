import { describe, expect, it } from "bun:test";
import { money, MoneyAmountError } from "@paykernel/core";
import { formatTapIsoAmount, parseTapAmount, tapMajorNumber } from "./money";

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

describe("parseTapAmount", () => {
  it("parses JSON numbers through Money", () => {
    expect(parseTapAmount(1, "SAR").amount).toBe("1.00");
    expect(parseTapAmount("1.200", "KWD").amount).toBe("1.200");
  });

  it("rejects non-numeric amounts", () => {
    expect(() => parseTapAmount({ n: 1 }, "SAR")).toThrow();
  });
});
