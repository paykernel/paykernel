import { createCheckoutKernel } from "@paykernel/example-checkout-kernel";
import { createElysiaCheckoutApp } from "./app";

export { createElysiaCheckoutApp } from "./app";

if (import.meta.main) {
  const kernel = await createCheckoutKernel();
  const app = createElysiaCheckoutApp(kernel);
  const rawPort = process.env.PORT;
  const parsed = rawPort !== undefined && rawPort.length > 0 ? Number.parseInt(rawPort, 10) : 3000;
  const port = Number.isFinite(parsed) ? parsed : 3000;
  app.listen(port);
}
