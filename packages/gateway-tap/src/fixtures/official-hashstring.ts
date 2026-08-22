/**
 * TAP-HASH-VECTOR — Tap-published hashstring + body, not a self-signed round-trip.
 *
 * Source: Create a Charge OpenAPI “post response” example
 * (https://developers.tap.company/reference/create-a-charge) header `hashstring`
 * plus the posted charge JSON. HMAC key is Tap’s documented example secret from
 * the webhook hashstring PHP sample
 * (https://developers.tap.company/docs/webhook `sk_test_XKokBfNWv6FIYuTMg5sLPjhJ`).
 *
 * Not passed through `assertFixtureSafe`: Tap `reference.payment` and
 * `transaction.created` are 13–19 digit gateway identifiers, which the testkit
 * PAN scan would reject. They are not cardholder data.
 */

/** Tap docs example secret (`sk_test_…`). Not a live merchant key. */
export const TAP_DOCS_EXAMPLE_SECRET = "sk_test_XKokBfNWv6FIYuTMg5sLPjhJ";

/** `hashstring` header on the same Create-a-Charge posted-response example. */
export const TAP_DOCS_CHARGE_HASHSTRING =
  "16250de7d6c99b7cbb9866f91c348791a5a1dca3649d6ce64f0699c97da49a90";

/** Minimal charge JSON that supplies hashstring fields (ISO amount pad is load-bearing). */
export function tapDocsPostedCharge(): Record<string, unknown> {
  return {
    id: "chg_TS032420221429Km940109459",
    object: "charge",
    status: "CAPTURED",
    amount: 1,
    currency: "USD",
    transaction: { created: "1662042581741" },
    reference: {
      payment: "2401221429094596907",
      gateway: "123456789",
    },
  };
}
