import {
  processWebhookHttp,
  webhookHttpResultToResponse,
  type ProcessWebhookHttpInput,
} from "@paykernel/integration-http";
import type { Handler } from "hono";

export function honoWebhook(
  options: Omit<ProcessWebhookHttpInput, "rawBody" | "headers" | "query">,
): Handler {
  return async (c) => {
    const request: Request = c.req.raw;
    const rawBody = await request.text();
    const headers: Headers = request.headers;
    const query = c.req.query();
    const result = await processWebhookHttp({
      ...options,
      rawBody,
      headers,
      query,
    });
    return webhookHttpResultToResponse(result);
  };
}
