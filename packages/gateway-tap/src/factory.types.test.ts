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

type RegisteredName = Parameters<typeof client.gateway>[0];
const _onlyTap: RegisteredName = "tap";
void _onlyTap;

// @ts-expect-error unknown name is not in the inferred map
const _stripe: RegisteredName = "stripe";
void _stripe;
