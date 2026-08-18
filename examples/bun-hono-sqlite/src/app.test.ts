import { runCheckoutHttpScenarios } from "@paykernel/example-checkout-kernel";
import { createHonoCheckoutApp } from "./app";

runCheckoutHttpScenarios("hono", (k) => {
  const app = createHonoCheckoutApp(k);
  return { fetch: (req) => Promise.resolve(app.fetch(req)) };
});
