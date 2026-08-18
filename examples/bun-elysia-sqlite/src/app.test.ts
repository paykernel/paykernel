import {
  runCheckoutHttpScenarios,
  type CheckoutFetchApp,
} from "@paykernel/example-checkout-kernel";
import { createElysiaCheckoutApp } from "./app";

runCheckoutHttpScenarios("elysia", (kernel): CheckoutFetchApp => {
  const app = createElysiaCheckoutApp(kernel);
  return {
    fetch(req) {
      return app.handle(req);
    },
  };
});
