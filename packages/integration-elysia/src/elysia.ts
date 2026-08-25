import { Elysia } from "elysia";
import {
  processWebhookHttp,
  webhookHttpResultToResponse,
  type ProcessWebhookHttpInput,
} from "@paykernel/integration-http";

export function elysiaWebhook(
  path: string,
  options: Omit<ProcessWebhookHttpInput, "rawBody" | "headers" | "query">,
): Elysia {
  const app = new Elysia();

  app.post(
    path,
    async ({ request }) => {
      const rawBody = await request.text();
      const headers: Headers = request.headers;
      const url = new URL(request.url);
      const query: Record<string, string | undefined> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      const result = await processWebhookHttp({
        ...options,
        rawBody,
        headers,
        query,
      });
      return webhookHttpResultToResponse(result);
    },
    { parse: "none" } as { parse: "none" },
  );

  return app;
}
