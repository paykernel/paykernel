import {
  processWebhookHttp,
  webhookHttpResultToResponse,
  requireStringBindings,
  type ProcessWebhookHttpInput,
} from "@paykernel/integration-http";

export function readWorkerBindings<K extends string>(
  env: Record<string, string | undefined>,
  keys: readonly K[],
): { [P in K]: string } {
  return requireStringBindings(env, keys);
}

export async function handleCloudflareWebhook(
  request: Request,
  options: Omit<ProcessWebhookHttpInput, "rawBody" | "headers" | "query">,
): Promise<Response> {
  const rawBody = await request.text();
  const headers: Headers = request.headers;
  const url = new URL(request.url);
  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((value, key) => {
    if (!(key in query)) query[key] = value;
  });
  const result = await processWebhookHttp({
    ...options,
    rawBody,
    headers,
    query,
  });
  return webhookHttpResultToResponse(result);
}

/**
 * Create a `fetch`-style handler that delegates to {@link handleCloudflareWebhook}.
 *
 * **Path guard is required.** This helper only guards the HTTP method and
 * returns `405 Method Not Allowed` for non-POST requests. Callers MUST check
 * `request.url` pathname before delegating (for example `POST /webhooks/stripe`).
 * The example `createCloudflareCheckoutFetch` in `examples/cloudflare-workers-fetch`
 * already does `request.method === "POST" && url.pathname === "/webhooks/stripe"`.
 * Without a path guard the handler would accept every POST on the Worker.
 */
export function createCloudflareWebhookFetchHandler(
  options: Omit<ProcessWebhookHttpInput, "rawBody" | "headers" | "query">,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    return handleCloudflareWebhook(request, options);
  };
}
