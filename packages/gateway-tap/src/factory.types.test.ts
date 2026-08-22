import { createPaymentClient } from "@paykernel/core";
import { tapGateway, type TapGateway } from "./index";

const client = createPaymentClient({
  gateways: {
    tap: tapGateway({ secretKey: "sk_test_types" }),
  },
  defaultGateway: "tap",
});

const gateway: TapGateway = client.gateway("tap");
void gateway;

function _assignTapCreateLiteral() {
  void gateway.createPayment({
    amount: 10,
    currency: "SAR",
    callbackUrl: "https://merchant.example/callback",
    tapCustomer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  });
}
void _assignTapCreateLiteral;

function _rejectInlineCustomerWithoutLastName() {
  void gateway.createPayment({
    amount: 10,
    currency: "SAR",
    callbackUrl: "https://merchant.example/callback",
    // @ts-expect-error inline tapCustomer requires lastName
    tapCustomer: { firstName: "Ada", email: "ada@example.com" },
  });
}
void _rejectInlineCustomerWithoutLastName;

type RegisteredName = Parameters<typeof client.gateway>[0];
const _onlyTap: RegisteredName = "tap";
void _onlyTap;

// @ts-expect-error unknown name is not in the inferred map
const _stripe: RegisteredName = "stripe";
void _stripe;
