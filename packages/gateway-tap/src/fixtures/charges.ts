/** Synthetic Tap charge objects for tests. No live keys, PANs, or 13–19 digit runs. */

export const TAP_TEST_SECRET = "sk_test_conformance_placeholder_not_live";

export function initiatedCharge(overrides: Record<string, unknown> = {}) {
  return {
    id: "chg_testInitiated01",
    object: "charge",
    live_mode: false,
    api_version: "V2",
    status: "INITIATED",
    amount: 10.5,
    currency: "SAR",
    transaction: {
      created: "1000000000",
      url: "https://checkout.payments.tap.company?mode=page&token=testtoken",
    },
    reference: {
      gateway: "",
      payment: "payref1",
      order: "ord_01",
    },
    response: { code: "100", message: "Initiated" },
    customer: { id: "cus_testCustomer01", first_name: "Ada", email: "ada@example.com" },
    source: { object: "source", id: "src_all" },
    redirect: { status: "PENDING", url: "https://merchant.example/callback" },
    post: { status: "PENDING", url: "https://merchant.example/post" },
    ...overrides,
  };
}

export function capturedCharge(overrides: Record<string, unknown> = {}) {
  return {
    ...initiatedCharge({
      status: "CAPTURED",
      response: { code: "000", message: "Captured" },
      transaction: { created: "1000000000" },
      ...overrides,
    }),
  };
}

export function declinedCharge(overrides: Record<string, unknown> = {}) {
  return initiatedCharge({
    status: "DECLINED",
    response: { code: "505", message: "Declined, Insufficient Funds" },
    transaction: { created: "1000000000" },
    ...overrides,
  });
}

export function authorizedObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "auth_testAuthorize01",
    object: "authorize",
    live_mode: false,
    api_version: "V2",
    status: "AUTHORIZED",
    amount: 10.5,
    currency: "SAR",
    transaction: { created: "1000000000" },
    reference: { gateway: "gwref", payment: "payref1" },
    response: { code: "001", message: "Authorized" },
    customer: { id: "cus_testCustomer01" },
    source: { object: "token", id: "tok_testToken01" },
    redirect: { status: "SUCCESS", url: "https://merchant.example/callback" },
    ...overrides,
  };
}

export function refundedObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "re_testRefund01",
    object: "refund",
    status: "REFUNDED",
    amount: 10.5,
    currency: "SAR",
    charge_id: "chg_testCaptured01",
    created: "1000000000",
    reference: { gateway: "gwref", payment: "payref1" },
    response: { code: "000", message: "Refunded" },
    ...overrides,
  };
}
