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
    query[key] = value;
  });
  const result = await processWebhookHttp({
    ...options,
    rawBody,
    headers,
    query,
  });
  return webhookHttpResultToResponse(result);
}

export function createCloudflareWebhookFetchHandler(
  options: Omit<ProcessWebhookHttpInput, "rawBody" | "headers" | "query">,
): (request: Request) => Promise<Response> {
  return (request: Request) => handleCloudflareWebhook(request, options);
}
