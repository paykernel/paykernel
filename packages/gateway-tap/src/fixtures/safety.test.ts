import { describe, expect, it } from "bun:test";
import { assertFixtureSafe } from "@paykernel/testkit";
import {
  authorizedObject,
  capturedCharge,
  declinedCharge,
  initiatedCharge,
  refundedObject,
  TAP_TEST_SECRET,
} from "./charges";

describe("fixture safety", () => {
  it("keeps committed Tap fixtures free of live secrets and PANs", () => {
    expect(TAP_TEST_SECRET.startsWith("sk_test_")).toBe(true);
    assertFixtureSafe({
      initiated: initiatedCharge(),
      captured: capturedCharge(),
      declined: declinedCharge(),
      authorized: authorizedObject(),
      refunded: refundedObject(),
    });
  });
});
