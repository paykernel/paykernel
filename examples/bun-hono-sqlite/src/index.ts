import { createCheckoutKernel } from "@paykernel/example-checkout-kernel";
import { createHonoCheckoutApp } from "./app";

export { createHonoCheckoutApp } from "./app";

if (import.meta.main) {
  const kernel = await createCheckoutKernel();
  const app = createHonoCheckoutApp(kernel);
  const port = Number(process.env.PORT ?? 3000);
  Bun.serve({
    port,
    fetch: (req) => app.fetch(req),
  });
  console.log(`listening on http://127.0.0.1:${port}`);
}
