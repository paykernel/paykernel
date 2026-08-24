import { describe, expect, it } from "bun:test";
import { InvalidRequestError } from "@paykernel/core";
import { myFatoorahRemainingRefundMajor, nestedRefundFromInvoice } from "./refund-support";
import { partialRefundStatusData } from "./fixtures/webhooks";

describe("myfatoorah refund support", () => {
  it("computes remaining from InvoiceValue minus non-canceled refunds", () => {
    const data = partialRefundStatusData();
    expect(myFatoorahRemainingRefundMajor(data.InvoiceAmount, data.Refunds, "SAR")).toBe(8);
  });

  it("ignores canceled refunds in the sum", () => {
    const data = partialRefundStatusData();
    data.Refunds.push({
      RefundId: 22299,
      ExternalIdentifier: "canceled-1",
      Comment: null,
      InvoiceId: 915102,
      Amount: 3,
      ServiceChargeOnCustomer: 0,
      RefundStatus: "Canceled",
    });
    expect(myFatoorahRemainingRefundMajor(data.InvoiceAmount, data.Refunds, "SAR")).toBe(8);
  });

  it("returns 0 when fully refunded", () => {
    const data = partialRefundStatusData();
    data.Refunds = [
      {
        RefundId: 22201,
        ExternalIdentifier: "refund-idem-1",
        Comment: null,
        InvoiceId: 915102,
        Amount: 10.5,
        ServiceChargeOnCustomer: 0,
        RefundStatus: "Refunded",
      },
    ];
    expect(myFatoorahRemainingRefundMajor(data.InvoiceAmount, data.Refunds, "SAR")).toBe(0);
  });

  it("throws when remaining is negative", () => {
    const data = partialRefundStatusData();
    data.Refunds = [
      {
        RefundId: 22201,
        ExternalIdentifier: "refund-idem-1",
        Comment: null,
        InvoiceId: 915102,
        Amount: 20,
        ServiceChargeOnCustomer: 0,
        RefundStatus: "Refunded",
      },
    ];
    expect(() => myFatoorahRemainingRefundMajor(data.InvoiceAmount, data.Refunds, "SAR")).toThrow(
      InvalidRequestError,
    );
  });

  it("throws when the invoice amount or refund list is unparseable", () => {
    expect(() => myFatoorahRemainingRefundMajor(undefined, [], "SAR")).toThrow(InvalidRequestError);
    // No refunds yet — remaining is full invoice amount (does not throw)
    expect(myFatoorahRemainingRefundMajor(10.5, undefined, "SAR")).toBe(10.5);
    expect(myFatoorahRemainingRefundMajor(10.5, [], "SAR")).toBe(10.5);
    expect(() => myFatoorahRemainingRefundMajor(10.5, [{ RefundId: 1 }], "SAR")).toThrow(
      InvalidRequestError,
    );
  });

  it("matches a nested refund by ExternalIdentifier", () => {
    const data = partialRefundStatusData();
    expect(nestedRefundFromInvoice(data.Refunds, "refund-idem-1")).toMatchObject({
      RefundId: 22201,
    });
  });

  it("maps a single nested refund without an ExternalIdentifier", () => {
    const refunds = [
      {
        RefundId: 22201,
        Comment: null,
        InvoiceId: 915102,
        Amount: 2.5,
        RefundStatus: "Refunded",
      },
    ];
    // Single unkeyed refund must not be mapped to an unrelated key (fail-closed)
    expect(nestedRefundFromInvoice(refunds, "any-key")).toBeUndefined();
    // Without a key, a single entry is still mappable
    expect(nestedRefundFromInvoice(refunds)).toMatchObject({
      RefundId: 22201,
    });
  });

  it("does not map a single nested refund with a different key", () => {
    const data = partialRefundStatusData();
    expect(nestedRefundFromInvoice(data.Refunds, "different-key")).toBeUndefined();
  });

  it("does not map multiple unmatched refunds", () => {
    const data = partialRefundStatusData();
    data.Refunds.push({
      RefundId: 22202,
      ExternalIdentifier: "refund-idem-2",
      Comment: null,
      InvoiceId: 915102,
      Amount: 1,
      ServiceChargeOnCustomer: 0,
      RefundStatus: "Pending",
    });
    expect(nestedRefundFromInvoice(data.Refunds, "other-key")).toBeUndefined();
  });

  it("returns undefined for empty / missing lists", () => {
    expect(nestedRefundFromInvoice([], "k")).toBeUndefined();
    expect(nestedRefundFromInvoice(undefined, "k")).toBeUndefined();
  });
});
