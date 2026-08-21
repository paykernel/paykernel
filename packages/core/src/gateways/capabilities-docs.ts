// file: packages/core/src/gateways/capabilities-docs.ts

/**
 * Pure helpers to render gateway capability comparison tables from manifests.
 * Used by scripts/generate-capability-docs.ts and drift tests.
 */

import { GATEWAY_CAPABILITY_KEYS } from "./gateway-capabilities";
import type { GatewayManifest } from "./gateway-manifest";

/** Banner every generated capability doc must start with. */
export const CAPABILITY_DOCS_BANNER =
  "<!-- auto-generated; do not hand-edit -->";

const YES = "✓";
const NO = "✗";

function cell(supported: boolean): string {
  return supported ? YES : NO;
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function columnLabel(manifest: GatewayManifest): string {
  return escapePipe(manifest.displayName ?? manifest.name);
}

/**
 * Build a markdown comparison document from gateway manifests.
 *
 * Table layout:
 * - rows = {@link GATEWAY_CAPABILITY_KEYS} (stable order)
 * - columns = providers (manifest order)
 * - cells = ✓ when claimed true, ✗ otherwise (missing capabilities → all ✗)
 *
 * Does not include secrets; only uses name/displayName/version/capabilities.
 */
export function generateGatewayCapabilitiesMarkdown(
  manifests: readonly GatewayManifest[],
): string {
  if (manifests.length === 0) {
    return [
      CAPABILITY_DOCS_BANNER,
      "",
      "# Gateway capabilities",
      "",
      "_No gateway manifests provided._",
      "",
    ].join("\n");
  }

  const headers = ["Capability", ...manifests.map(columnLabel)];
  const separator = headers.map(() => "---");

  const rows: string[] = [];
  for (const key of GATEWAY_CAPABILITY_KEYS) {
    const cells = manifests.map((m) => cell(m.capabilities?.[key] === true));
    rows.push(`| ${[key, ...cells].join(" | ")} |`);
  }

  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${separator.join(" | ")} |`;

  const providerList = manifests
    .map((m) => {
      const label = m.displayName ?? m.name;
      const version = m.version ? ` \`${m.version}\`` : "";
      return `- **${escapePipe(label)}** (\`${escapePipe(m.name)}\`)${version}`;
    })
    .join("\n");

  return [
    CAPABILITY_DOCS_BANNER,
    "",
    "# Gateway capabilities",
    "",
    "This matrix is **generated from code** (built-in capability claims on",
    "gateway manifests). Do not edit by hand — regenerate with:",
    "",
    "```bash",
    "bun run docs:capabilities",
    "```",
    "",
    "## Providers",
    "",
    providerList,
    "",
    "## Capability matrix",
    "",
    "Cells are `✓` when the adapter **claims** the capability on its",
    "`GatewayManifest.capabilities` / instance snapshot, otherwise `✗`.",
    "Claims are conservative: method presence alone does not imply `true`.",
    "",
    headerLine,
    sepLine,
    ...rows,
    "",
    "## Key notes",
    "",
    "- **partialCapture** / **partialRefunds**: optional `amount` on",
    "  `capturePayment` / `refundPayment`. Omitting `amount` is a full",
    "  capture/refund and does not require the partial flag.",
    "- **PayPal partialCapture**: claimed `true` because authorization",
    "  captures accept `amount` when `paypalCaptureType: \"authorization\"`.",
    "  PayPal order captures reject amount; callers must use",
    "  `paypalCaptureType: \"authorization\"` (authorize-then-capture).",
    "- **hostedCheckout**: first-class `createCheckoutSession` (Stripe Checkout",
    "  Session product), not every provider redirect URL.",
    "- **marketplaceSplits**: create-time split / transfer surface (e.g. Moyasar",
    "  `splits`).",
    "- **providerRecurring**: extension-only; default `false`. Checkout",
    "  subscription mode alone does not force `true`.",
    "- **customers** / **paymentMethods**: Stripe implements first-class",
    "  Customer create/get and PaymentMethod attach/list/detach. Other",
    "  built-ins stay false until they expose the same surface.",
    "- **disputes**: Stripe implements get/list/submit evidence. Other",
    "  built-ins stay false (PayPal Customer Dispute webhooks still dual-write).",
    "- **paymentLinks**: Stripe Payment Links product only. Not Checkout",
    "  Sessions and not PayPal Pay Links.",
    "- **tokenization**: claimed only when the adapter exposes first-class",
    "  setup / save-payment-method APIs. Stripe `tok_…` on attach is",
    "  `paymentMethods`, not this key (built-ins stay false).",
    "",
    "## Inspecting support at runtime",
    "",
    "```ts",
    'import { createPaymentClient, stripeGateway } from "@paykernel/core";',
    "",
    "const client = createPaymentClient({",
    "  gateways: { stripe: stripeGateway({ /* closed-over credentials */ }) },",
    '  defaultGateway: "stripe",',
    "});",
    "",
    'const gateway = client.gateway("stripe");',
    'if (gateway.supports("partialRefunds")) {',
    "  // partial amount is a viable path on this adapter",
    "}",
    "```",
    "",
  ].join("\n");
}
