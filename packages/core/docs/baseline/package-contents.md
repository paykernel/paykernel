# Package Contents Baseline

> **Phase 0 freeze artifact.** Records the published file set and primary bundle fingerprint.
> Do not hand-edit inventory tables; regenerate with the command below.

## Generation metadata

- **Generated at (UTC)**: 2026-08-21T05:12:03.424Z
- **Command**: `bun run scripts/record-package-baseline.ts`
- **Package**: `@paykernel/core@0.1.0-next.0`

## Entry points (from package.json)

- **main**: `./dist/index.js`
- **types**: `./dist/index.d.ts`
- **type**: `module`
- **exports**:
```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
}
```

- **files** field:
```json
[
  "dist",
  "docs",
  "README.md",
  "LICENSE"
]
```

## Primary bundle fingerprint

| Path | Bytes | Human | SHA-256 |
| --- | ---: | --- | --- |
| `dist/index.js` | 505923 | 494.1 KB | `10d31afcc5f2ef84bb51a5309987ff9530c74eb598f3ddb41cf44df63cc5d448` |

Use this hash to detect unintended bundle changes between Phase 0 freezes.

## Simulated package files (from `files` field)

Walk of paths listed in `package.json#files`, plus always-included `package.json`. Sorted by path.

| Path | Bytes |
| --- | ---: |
| `dist/client.d.ts` | 13743 |
| `dist/client.d.ts.map` | 5268 |
| `dist/create-payment-client.d.ts` | 2373 |
| `dist/create-payment-client.d.ts.map` | 1337 |
| `dist/errors.d.ts` | 4669 |
| `dist/errors.d.ts.map` | 2111 |
| `dist/gateways/base.gateway.d.ts` | 5246 |
| `dist/gateways/base.gateway.d.ts.map` | 2297 |
| `dist/gateways/builtin-capabilities.d.ts` | 3714 |
| `dist/gateways/builtin-capabilities.d.ts.map` | 691 |
| `dist/gateways/capabilities-docs.d.ts` | 726 |
| `dist/gateways/capabilities-docs.d.ts.map` | 320 |
| `dist/gateways/factories.d.ts` | 1976 |
| `dist/gateways/factories.d.ts.map` | 806 |
| `dist/gateways/gateway-adapter.d.ts` | 1116 |
| `dist/gateways/gateway-adapter.d.ts.map` | 571 |
| `dist/gateways/gateway-capabilities.d.ts` | 6319 |
| `dist/gateways/gateway-capabilities.d.ts.map` | 1012 |
| `dist/gateways/gateway-context.d.ts` | 2916 |
| `dist/gateways/gateway-context.d.ts.map` | 1066 |
| `dist/gateways/gateway-manifest.d.ts` | 1713 |
| `dist/gateways/gateway-manifest.d.ts.map` | 594 |
| `dist/gateways/gateway-registry.d.ts` | 4235 |
| `dist/gateways/gateway-registry.d.ts.map` | 1937 |
| `dist/gateways/gateway.interface.d.ts` | 5900 |
| `dist/gateways/gateway.interface.d.ts.map` | 2855 |
| `dist/gateways/index.d.ts` | 1665 |
| `dist/gateways/index.d.ts.map` | 1190 |
| `dist/gateways/moyasar/moyasar.gateway.d.ts` | 15585 |
| `dist/gateways/moyasar/moyasar.gateway.d.ts.map` | 2821 |
| `dist/gateways/paymob/paymob.gateway.d.ts` | 18380 |
| `dist/gateways/paymob/paymob.gateway.d.ts.map` | 4036 |
| `dist/gateways/paypal/paypal.gateway.d.ts` | 16550 |
| `dist/gateways/paypal/paypal.gateway.d.ts.map` | 3859 |
| `dist/gateways/stripe/stripe.gateway.d.ts` | 7784 |
| `dist/gateways/stripe/stripe.gateway.d.ts.map` | 3219 |
| `dist/hooks/hooks.manager.d.ts` | 3864 |
| `dist/hooks/hooks.manager.d.ts.map` | 1493 |
| `dist/hooks/hooks.types.d.ts` | 6901 |
| `dist/hooks/hooks.types.d.ts.map` | 2995 |
| `dist/hooks/money-identity.d.ts` | 1652 |
| `dist/hooks/money-identity.d.ts.map` | 400 |
| `dist/index.d.ts` | 11560 |
| `dist/index.d.ts.map` | 6181 |
| `dist/index.js` | 505923 |
| `dist/runtime/abort.d.ts` | 3716 |
| `dist/runtime/abort.d.ts.map` | 1352 |
| `dist/runtime/clock.d.ts` | 588 |
| `dist/runtime/clock.d.ts.map` | 330 |
| `dist/runtime/crypto-portable.d.ts` | 2515 |
| `dist/runtime/crypto-portable.d.ts.map` | 1519 |
| `dist/runtime/crypto-provider.d.ts` | 1239 |
| `dist/runtime/crypto-provider.d.ts.map` | 457 |
| `dist/runtime/index.d.ts` | 1237 |
| `dist/runtime/index.d.ts.map` | 920 |
| `dist/runtime/operation-context.d.ts` | 3463 |
| `dist/runtime/operation-context.d.ts.map` | 2032 |
| `dist/runtime/payment-runtime.d.ts` | 1769 |
| `dist/runtime/payment-runtime.d.ts.map` | 726 |
| `dist/types/checkout.types.d.ts` | 2943 |
| `dist/types/checkout.types.d.ts.map` | 1702 |
| `dist/types/config.types.d.ts` | 10891 |
| `dist/types/config.types.d.ts.map` | 3879 |
| `dist/types/customer.types.d.ts` | 4024 |
| `dist/types/customer.types.d.ts.map` | 2875 |
| `dist/types/dispute.types.d.ts` | 2961 |
| `dist/types/dispute.types.d.ts.map` | 2012 |
| `dist/types/domain-status.d.ts` | 4148 |
| `dist/types/domain-status.d.ts.map` | 1404 |
| `dist/types/marketplace.types.d.ts` | 1350 |
| `dist/types/marketplace.types.d.ts.map` | 956 |
| `dist/types/moyasar-source.types.d.ts` | 5185 |
| `dist/types/moyasar-source.types.d.ts.map` | 2406 |
| `dist/types/operation-result.d.ts` | 17946 |
| `dist/types/operation-result.d.ts.map` | 6382 |
| `dist/types/payment-event.d.ts` | 13442 |
| `dist/types/payment-event.d.ts.map` | 6240 |
| `dist/types/payment-link.types.d.ts` | 2079 |
| `dist/types/payment-link.types.d.ts.map` | 1618 |
| `dist/types/payment.types.d.ts` | 23603 |
| `dist/types/payment.types.d.ts.map` | 7641 |
| `dist/types/provider-refs.d.ts` | 3146 |
| `dist/types/provider-refs.d.ts.map` | 1488 |
| `dist/types/stable-payment-event-types.d.ts` | 1143 |
| `dist/types/stable-payment-event-types.d.ts.map` | 367 |
| `dist/types/validation.d.ts` | 269059 |
| `dist/types/validation.d.ts.map` | 8783 |
| `dist/types/webhook-event-map.d.ts` | 5831 |
| `dist/types/webhook-event-map.d.ts.map` | 1496 |
| `dist/types/webhook.types.d.ts` | 13548 |
| `dist/types/webhook.types.d.ts.map` | 7984 |
| `dist/utils/currency.d.ts` | 2940 |
| `dist/utils/currency.d.ts.map` | 680 |
| `dist/utils/idempotency.d.ts` | 4818 |
| `dist/utils/idempotency.d.ts.map` | 1455 |
| `dist/utils/logger.d.ts` | 1812 |
| `dist/utils/logger.d.ts.map` | 815 |
| `dist/utils/money.d.ts` | 6513 |
| `dist/utils/money.d.ts.map` | 2185 |
| `dist/utils/raw-card.d.ts` | 1283 |
| `dist/utils/raw-card.d.ts.map` | 214 |
| `dist/utils/retry.d.ts` | 2409 |
| `dist/utils/retry.d.ts.map` | 966 |
| `docs/baseline/coverage-policy.md` | 6282 |
| `docs/baseline/entry-points.md` | 7498 |
| `docs/baseline/package-contents.md` | 12296 |
| `docs/baseline/public-api.md` | 14263 |
| `docs/baseline/README.md` | 3493 |
| `docs/behavioral-contracts.md` | 29801 |
| `docs/custom-gateways.md` | 12414 |
| `docs/customers.md` | 2848 |
| `docs/disputes.md` | 2225 |
| `docs/gateway-capabilities.md` | 3161 |
| `docs/hooks.md` | 11762 |
| `docs/hosted-checkout.md` | 2757 |
| `docs/logging.md` | 3731 |
| `docs/marketplace.md` | 1115 |
| `docs/money.md` | 10404 |
| `docs/moyasar.md` | 32247 |
| `docs/operation-results.md` | 16485 |
| `docs/payment-links.md` | 1476 |
| `docs/paymob.md` | 25486 |
| `docs/paypal.md` | 29885 |
| `docs/plugin-architecture.md` | 9521 |
| `docs/runtime.md` | 16800 |
| `docs/storage-adapters.md` | 1953 |
| `docs/stripe.md` | 37117 |
| `docs/telemetry.md` | 6076 |
| `docs/webhook-events.md` | 19806 |
| `docs/webhooks.md` | 17866 |
| `LICENSE` | 1076 |
| `package.json` | 2184 |
| `README.md` | 20129 |

**Count**: 133 files · **Total bytes**: 1540211 (1.47 MB)

## npm pack --dry-run

### Tarball summary

| Field | Value |
| --- | --- |
| name | `@paykernel/core` |
| version | `0.1.0-next.0` |
| filename | `paykernel-core-0.1.0-next.0.tgz` |
| package size | `322.2 kB` |
| unpacked size | `1.5 MB` |
| shasum | `a460dca63ca36b50904543a7b749aaa4790d6591` |
| integrity | `sha512-qojB9bhkfvk6+[...]tthbYx3+kbNKg==` |
| total files | `133` |

### Tarball file list (sorted by path)

| Size (npm) | Path |
| --- | --- |
| 13.7kB | `dist/client.d.ts` |
| 5.3kB | `dist/client.d.ts.map` |
| 2.4kB | `dist/create-payment-client.d.ts` |
| 1.3kB | `dist/create-payment-client.d.ts.map` |
| 4.7kB | `dist/errors.d.ts` |
| 2.1kB | `dist/errors.d.ts.map` |
| 5.2kB | `dist/gateways/base.gateway.d.ts` |
| 2.3kB | `dist/gateways/base.gateway.d.ts.map` |
| 3.7kB | `dist/gateways/builtin-capabilities.d.ts` |
| 691B | `dist/gateways/builtin-capabilities.d.ts.map` |
| 726B | `dist/gateways/capabilities-docs.d.ts` |
| 320B | `dist/gateways/capabilities-docs.d.ts.map` |
| 2.0kB | `dist/gateways/factories.d.ts` |
| 806B | `dist/gateways/factories.d.ts.map` |
| 1.1kB | `dist/gateways/gateway-adapter.d.ts` |
| 571B | `dist/gateways/gateway-adapter.d.ts.map` |
| 6.3kB | `dist/gateways/gateway-capabilities.d.ts` |
| 1.0kB | `dist/gateways/gateway-capabilities.d.ts.map` |
| 2.9kB | `dist/gateways/gateway-context.d.ts` |
| 1.1kB | `dist/gateways/gateway-context.d.ts.map` |
| 1.7kB | `dist/gateways/gateway-manifest.d.ts` |
| 594B | `dist/gateways/gateway-manifest.d.ts.map` |
| 4.2kB | `dist/gateways/gateway-registry.d.ts` |
| 1.9kB | `dist/gateways/gateway-registry.d.ts.map` |
| 5.9kB | `dist/gateways/gateway.interface.d.ts` |
| 2.9kB | `dist/gateways/gateway.interface.d.ts.map` |
| 1.7kB | `dist/gateways/index.d.ts` |
| 1.2kB | `dist/gateways/index.d.ts.map` |
| 15.6kB | `dist/gateways/moyasar/moyasar.gateway.d.ts` |
| 2.8kB | `dist/gateways/moyasar/moyasar.gateway.d.ts.map` |
| 18.4kB | `dist/gateways/paymob/paymob.gateway.d.ts` |
| 4.0kB | `dist/gateways/paymob/paymob.gateway.d.ts.map` |
| 16.6kB | `dist/gateways/paypal/paypal.gateway.d.ts` |
| 3.9kB | `dist/gateways/paypal/paypal.gateway.d.ts.map` |
| 7.8kB | `dist/gateways/stripe/stripe.gateway.d.ts` |
| 3.2kB | `dist/gateways/stripe/stripe.gateway.d.ts.map` |
| 3.9kB | `dist/hooks/hooks.manager.d.ts` |
| 1.5kB | `dist/hooks/hooks.manager.d.ts.map` |
| 6.9kB | `dist/hooks/hooks.types.d.ts` |
| 3.0kB | `dist/hooks/hooks.types.d.ts.map` |
| 1.7kB | `dist/hooks/money-identity.d.ts` |
| 400B | `dist/hooks/money-identity.d.ts.map` |
| 11.6kB | `dist/index.d.ts` |
| 6.2kB | `dist/index.d.ts.map` |
| 505.9kB | `dist/index.js` |
| 3.7kB | `dist/runtime/abort.d.ts` |
| 1.4kB | `dist/runtime/abort.d.ts.map` |
| 588B | `dist/runtime/clock.d.ts` |
| 330B | `dist/runtime/clock.d.ts.map` |
| 2.5kB | `dist/runtime/crypto-portable.d.ts` |
| 1.5kB | `dist/runtime/crypto-portable.d.ts.map` |
| 1.2kB | `dist/runtime/crypto-provider.d.ts` |
| 457B | `dist/runtime/crypto-provider.d.ts.map` |
| 1.2kB | `dist/runtime/index.d.ts` |
| 920B | `dist/runtime/index.d.ts.map` |
| 3.5kB | `dist/runtime/operation-context.d.ts` |
| 2.0kB | `dist/runtime/operation-context.d.ts.map` |
| 1.8kB | `dist/runtime/payment-runtime.d.ts` |
| 726B | `dist/runtime/payment-runtime.d.ts.map` |
| 2.9kB | `dist/types/checkout.types.d.ts` |
| 1.7kB | `dist/types/checkout.types.d.ts.map` |
| 10.9kB | `dist/types/config.types.d.ts` |
| 3.9kB | `dist/types/config.types.d.ts.map` |
| 4.0kB | `dist/types/customer.types.d.ts` |
| 2.9kB | `dist/types/customer.types.d.ts.map` |
| 3.0kB | `dist/types/dispute.types.d.ts` |
| 2.0kB | `dist/types/dispute.types.d.ts.map` |
| 4.1kB | `dist/types/domain-status.d.ts` |
| 1.4kB | `dist/types/domain-status.d.ts.map` |
| 1.4kB | `dist/types/marketplace.types.d.ts` |
| 956B | `dist/types/marketplace.types.d.ts.map` |
| 5.2kB | `dist/types/moyasar-source.types.d.ts` |
| 2.4kB | `dist/types/moyasar-source.types.d.ts.map` |
| 17.9kB | `dist/types/operation-result.d.ts` |
| 6.4kB | `dist/types/operation-result.d.ts.map` |
| 13.4kB | `dist/types/payment-event.d.ts` |
| 6.2kB | `dist/types/payment-event.d.ts.map` |
| 2.1kB | `dist/types/payment-link.types.d.ts` |
| 1.6kB | `dist/types/payment-link.types.d.ts.map` |
| 23.6kB | `dist/types/payment.types.d.ts` |
| 7.6kB | `dist/types/payment.types.d.ts.map` |
| 3.1kB | `dist/types/provider-refs.d.ts` |
| 1.5kB | `dist/types/provider-refs.d.ts.map` |
| 1.1kB | `dist/types/stable-payment-event-types.d.ts` |
| 367B | `dist/types/stable-payment-event-types.d.ts.map` |
| 269.1kB | `dist/types/validation.d.ts` |
| 8.8kB | `dist/types/validation.d.ts.map` |
| 5.8kB | `dist/types/webhook-event-map.d.ts` |
| 1.5kB | `dist/types/webhook-event-map.d.ts.map` |
| 13.5kB | `dist/types/webhook.types.d.ts` |
| 8.0kB | `dist/types/webhook.types.d.ts.map` |
| 2.9kB | `dist/utils/currency.d.ts` |
| 680B | `dist/utils/currency.d.ts.map` |
| 4.8kB | `dist/utils/idempotency.d.ts` |
| 1.5kB | `dist/utils/idempotency.d.ts.map` |
| 1.8kB | `dist/utils/logger.d.ts` |
| 815B | `dist/utils/logger.d.ts.map` |
| 6.5kB | `dist/utils/money.d.ts` |
| 2.2kB | `dist/utils/money.d.ts.map` |
| 1.3kB | `dist/utils/raw-card.d.ts` |
| 214B | `dist/utils/raw-card.d.ts.map` |
| 2.4kB | `dist/utils/retry.d.ts` |
| 966B | `dist/utils/retry.d.ts.map` |
| 6.3kB | `docs/baseline/coverage-policy.md` |
| 7.5kB | `docs/baseline/entry-points.md` |
| 12.3kB | `docs/baseline/package-contents.md` |
| 14.3kB | `docs/baseline/public-api.md` |
| 3.5kB | `docs/baseline/README.md` |
| 29.8kB | `docs/behavioral-contracts.md` |
| 12.4kB | `docs/custom-gateways.md` |
| 2.8kB | `docs/customers.md` |
| 2.2kB | `docs/disputes.md` |
| 3.2kB | `docs/gateway-capabilities.md` |
| 11.8kB | `docs/hooks.md` |
| 2.8kB | `docs/hosted-checkout.md` |
| 3.7kB | `docs/logging.md` |
| 1.1kB | `docs/marketplace.md` |
| 10.4kB | `docs/money.md` |
| 32.2kB | `docs/moyasar.md` |
| 16.5kB | `docs/operation-results.md` |
| 1.5kB | `docs/payment-links.md` |
| 25.5kB | `docs/paymob.md` |
| 29.9kB | `docs/paypal.md` |
| 9.5kB | `docs/plugin-architecture.md` |
| 16.8kB | `docs/runtime.md` |
| 2.0kB | `docs/storage-adapters.md` |
| 37.1kB | `docs/stripe.md` |
| 6.1kB | `docs/telemetry.md` |
| 19.8kB | `docs/webhook-events.md` |
| 17.9kB | `docs/webhooks.md` |
| 1.1kB | `LICENSE` |
| 2.2kB | `package.json` |
| 20.1kB | `README.md` |

**Count**: 133 files

## Notes

- This baseline freezes **what is published**, not payment business logic.
- `docs/baseline/*` generated by Phase 0 will appear in the pack once committed (because `docs` is in `files`).
- Do not add CommonJS dual-publish or change `exports` solely to satisfy packaging tools without treating it as a public contract change.
- Secrets must never appear in fixtures, pack contents, or this document.
