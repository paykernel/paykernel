# Package Contents Baseline

> **Phase 0 freeze artifact.** Records the published file set and primary bundle fingerprint.
> Do not hand-edit inventory tables; regenerate with the command below.

## Generation metadata

- **Generated at (UTC)**: 2026-08-18T11:25:55.971Z
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
| `dist/index.js` | 424089 | 414.1 KB | `47614693dfd9576efa436f2001761969a58e907e45483f7c973cc0b6ea394a40` |

Use this hash to detect unintended bundle changes between Phase 0 freezes.

## Simulated package files (from `files` field)

Walk of paths listed in `package.json#files`, plus always-included `package.json`. Sorted by path.

| Path | Bytes |
| --- | ---: |
| `dist/client.d.ts` | 10246 |
| `dist/client.d.ts.map` | 3262 |
| `dist/create-payment-client.d.ts` | 2373 |
| `dist/create-payment-client.d.ts.map` | 1337 |
| `dist/errors.d.ts` | 4669 |
| `dist/errors.d.ts.map` | 2111 |
| `dist/gateways/base.gateway.d.ts` | 5246 |
| `dist/gateways/base.gateway.d.ts.map` | 2296 |
| `dist/gateways/builtin-capabilities.d.ts` | 3510 |
| `dist/gateways/builtin-capabilities.d.ts.map` | 688 |
| `dist/gateways/capabilities-docs.d.ts` | 726 |
| `dist/gateways/capabilities-docs.d.ts.map` | 320 |
| `dist/gateways/factories.d.ts` | 1976 |
| `dist/gateways/factories.d.ts.map` | 806 |
| `dist/gateways/gateway-adapter.d.ts` | 1116 |
| `dist/gateways/gateway-adapter.d.ts.map` | 571 |
| `dist/gateways/gateway-capabilities.d.ts` | 5897 |
| `dist/gateways/gateway-capabilities.d.ts.map` | 1006 |
| `dist/gateways/gateway-context.d.ts` | 2916 |
| `dist/gateways/gateway-context.d.ts.map` | 1066 |
| `dist/gateways/gateway-manifest.d.ts` | 1713 |
| `dist/gateways/gateway-manifest.d.ts.map` | 594 |
| `dist/gateways/gateway-registry.d.ts` | 4235 |
| `dist/gateways/gateway-registry.d.ts.map` | 1937 |
| `dist/gateways/gateway.interface.d.ts` | 3981 |
| `dist/gateways/gateway.interface.d.ts.map` | 1561 |
| `dist/gateways/index.d.ts` | 1665 |
| `dist/gateways/index.d.ts.map` | 1190 |
| `dist/gateways/moyasar/moyasar.gateway.d.ts` | 14243 |
| `dist/gateways/moyasar/moyasar.gateway.d.ts.map` | 2655 |
| `dist/gateways/paymob/paymob.gateway.d.ts` | 16747 |
| `dist/gateways/paymob/paymob.gateway.d.ts.map` | 3973 |
| `dist/gateways/paypal/paypal.gateway.d.ts` | 14931 |
| `dist/gateways/paypal/paypal.gateway.d.ts.map` | 3781 |
| `dist/gateways/stripe/stripe.gateway.d.ts` | 6322 |
| `dist/gateways/stripe/stripe.gateway.d.ts.map` | 2558 |
| `dist/hooks/hooks.manager.d.ts` | 3864 |
| `dist/hooks/hooks.manager.d.ts.map` | 1493 |
| `dist/hooks/hooks.types.d.ts` | 6670 |
| `dist/hooks/hooks.types.d.ts.map` | 2861 |
| `dist/hooks/money-identity.d.ts` | 1585 |
| `dist/hooks/money-identity.d.ts.map` | 398 |
| `dist/index.d.ts` | 9652 |
| `dist/index.d.ts.map` | 5289 |
| `dist/index.js` | 424089 |
| `dist/runtime/abort.d.ts` | 3463 |
| `dist/runtime/abort.d.ts.map` | 1349 |
| `dist/runtime/clock.d.ts` | 360 |
| `dist/runtime/clock.d.ts.map` | 253 |
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
| `dist/types/config.types.d.ts` | 10891 |
| `dist/types/config.types.d.ts.map` | 3879 |
| `dist/types/domain-status.d.ts` | 3327 |
| `dist/types/domain-status.d.ts.map` | 1197 |
| `dist/types/moyasar-source.types.d.ts` | 5185 |
| `dist/types/moyasar-source.types.d.ts.map` | 2406 |
| `dist/types/operation-result.d.ts` | 16916 |
| `dist/types/operation-result.d.ts.map` | 6364 |
| `dist/types/payment-event.d.ts` | 13560 |
| `dist/types/payment-event.d.ts.map` | 6332 |
| `dist/types/payment.types.d.ts` | 22911 |
| `dist/types/payment.types.d.ts.map` | 7509 |
| `dist/types/provider-refs.d.ts` | 3146 |
| `dist/types/provider-refs.d.ts.map` | 1488 |
| `dist/types/stable-payment-event-types.d.ts` | 1143 |
| `dist/types/stable-payment-event-types.d.ts.map` | 367 |
| `dist/types/validation.d.ts` | 265456 |
| `dist/types/validation.d.ts.map` | 8696 |
| `dist/types/webhook-event-map.d.ts` | 5371 |
| `dist/types/webhook-event-map.d.ts.map` | 1490 |
| `dist/types/webhook.types.d.ts` | 13548 |
| `dist/types/webhook.types.d.ts.map` | 7984 |
| `dist/utils/currency.d.ts` | 2940 |
| `dist/utils/currency.d.ts.map` | 680 |
| `dist/utils/idempotency.d.ts` | 4126 |
| `dist/utils/idempotency.d.ts.map` | 1380 |
| `dist/utils/logger.d.ts` | 1718 |
| `dist/utils/logger.d.ts.map` | 813 |
| `dist/utils/money.d.ts` | 6513 |
| `dist/utils/money.d.ts.map` | 2185 |
| `dist/utils/retry.d.ts` | 2409 |
| `dist/utils/retry.d.ts.map` | 966 |
| `docs/baseline/coverage-policy.md` | 6282 |
| `docs/baseline/entry-points.md` | 7498 |
| `docs/baseline/package-contents.md` | 14486 |
| `docs/baseline/public-api.md` | 12615 |
| `docs/baseline/README.md` | 3493 |
| `docs/behavioral-contracts.md` | 27503 |
| `docs/custom-gateways.md` | 12410 |
| `docs/gateway-capabilities.md` | 2698 |
| `docs/hooks.md` | 10900 |
| `docs/logging.md` | 3272 |
| `docs/money.md` | 10404 |
| `docs/moyasar.md` | 32247 |
| `docs/operation-results.md` | 16255 |
| `docs/paymob.md` | 23989 |
| `docs/paypal.md` | 29670 |
| `docs/plugin-architecture.md` | 9202 |
| `docs/runtime.md` | 16800 |
| `docs/storage-adapters.md` | 1949 |
| `docs/stripe.md` | 31218 |
| `docs/telemetry.md` | 6076 |
| `docs/webhook-events.md` | 19106 |
| `docs/webhooks.md` | 14734 |
| `LICENSE` | 1076 |
| `package.json` | 2184 |
| `README.md` | 15713 |

**Count**: 116 files · **Total bytes**: 1376103 (1.31 MB)

## npm pack --dry-run

### Tarball summary

| Field | Value |
| --- | --- |
| name | `@paykernel/core` |
| version | `0.1.0-next.0` |
| filename | `paykernel-core-0.1.0-next.0.tgz` |
| package size | `286.7 kB` |
| unpacked size | `1.4 MB` |
| shasum | `e341da9510c3e5abc6791e0f5d5250f945b4bcf7` |
| integrity | `sha512-1WTJ1nn30jjGK[...]586tIowCbftOw==` |
| total files | `116` |

### Tarball file list (sorted by path)

| Size (npm) | Path |
| --- | --- |
| 10.2kB | `dist/client.d.ts` |
| 3.3kB | `dist/client.d.ts.map` |
| 2.4kB | `dist/create-payment-client.d.ts` |
| 1.3kB | `dist/create-payment-client.d.ts.map` |
| 4.7kB | `dist/errors.d.ts` |
| 2.1kB | `dist/errors.d.ts.map` |
| 5.2kB | `dist/gateways/base.gateway.d.ts` |
| 2.3kB | `dist/gateways/base.gateway.d.ts.map` |
| 3.5kB | `dist/gateways/builtin-capabilities.d.ts` |
| 688B | `dist/gateways/builtin-capabilities.d.ts.map` |
| 726B | `dist/gateways/capabilities-docs.d.ts` |
| 320B | `dist/gateways/capabilities-docs.d.ts.map` |
| 2.0kB | `dist/gateways/factories.d.ts` |
| 806B | `dist/gateways/factories.d.ts.map` |
| 1.1kB | `dist/gateways/gateway-adapter.d.ts` |
| 571B | `dist/gateways/gateway-adapter.d.ts.map` |
| 5.9kB | `dist/gateways/gateway-capabilities.d.ts` |
| 1.0kB | `dist/gateways/gateway-capabilities.d.ts.map` |
| 2.9kB | `dist/gateways/gateway-context.d.ts` |
| 1.1kB | `dist/gateways/gateway-context.d.ts.map` |
| 1.7kB | `dist/gateways/gateway-manifest.d.ts` |
| 594B | `dist/gateways/gateway-manifest.d.ts.map` |
| 4.2kB | `dist/gateways/gateway-registry.d.ts` |
| 1.9kB | `dist/gateways/gateway-registry.d.ts.map` |
| 4.0kB | `dist/gateways/gateway.interface.d.ts` |
| 1.6kB | `dist/gateways/gateway.interface.d.ts.map` |
| 1.7kB | `dist/gateways/index.d.ts` |
| 1.2kB | `dist/gateways/index.d.ts.map` |
| 14.2kB | `dist/gateways/moyasar/moyasar.gateway.d.ts` |
| 2.7kB | `dist/gateways/moyasar/moyasar.gateway.d.ts.map` |
| 16.7kB | `dist/gateways/paymob/paymob.gateway.d.ts` |
| 4.0kB | `dist/gateways/paymob/paymob.gateway.d.ts.map` |
| 14.9kB | `dist/gateways/paypal/paypal.gateway.d.ts` |
| 3.8kB | `dist/gateways/paypal/paypal.gateway.d.ts.map` |
| 6.3kB | `dist/gateways/stripe/stripe.gateway.d.ts` |
| 2.6kB | `dist/gateways/stripe/stripe.gateway.d.ts.map` |
| 3.9kB | `dist/hooks/hooks.manager.d.ts` |
| 1.5kB | `dist/hooks/hooks.manager.d.ts.map` |
| 6.7kB | `dist/hooks/hooks.types.d.ts` |
| 2.9kB | `dist/hooks/hooks.types.d.ts.map` |
| 1.6kB | `dist/hooks/money-identity.d.ts` |
| 398B | `dist/hooks/money-identity.d.ts.map` |
| 9.7kB | `dist/index.d.ts` |
| 5.3kB | `dist/index.d.ts.map` |
| 424.1kB | `dist/index.js` |
| 3.5kB | `dist/runtime/abort.d.ts` |
| 1.3kB | `dist/runtime/abort.d.ts.map` |
| 360B | `dist/runtime/clock.d.ts` |
| 253B | `dist/runtime/clock.d.ts.map` |
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
| 10.9kB | `dist/types/config.types.d.ts` |
| 3.9kB | `dist/types/config.types.d.ts.map` |
| 3.3kB | `dist/types/domain-status.d.ts` |
| 1.2kB | `dist/types/domain-status.d.ts.map` |
| 5.2kB | `dist/types/moyasar-source.types.d.ts` |
| 2.4kB | `dist/types/moyasar-source.types.d.ts.map` |
| 16.9kB | `dist/types/operation-result.d.ts` |
| 6.4kB | `dist/types/operation-result.d.ts.map` |
| 13.6kB | `dist/types/payment-event.d.ts` |
| 6.3kB | `dist/types/payment-event.d.ts.map` |
| 22.9kB | `dist/types/payment.types.d.ts` |
| 7.5kB | `dist/types/payment.types.d.ts.map` |
| 3.1kB | `dist/types/provider-refs.d.ts` |
| 1.5kB | `dist/types/provider-refs.d.ts.map` |
| 1.1kB | `dist/types/stable-payment-event-types.d.ts` |
| 367B | `dist/types/stable-payment-event-types.d.ts.map` |
| 265.5kB | `dist/types/validation.d.ts` |
| 8.7kB | `dist/types/validation.d.ts.map` |
| 5.4kB | `dist/types/webhook-event-map.d.ts` |
| 1.5kB | `dist/types/webhook-event-map.d.ts.map` |
| 13.5kB | `dist/types/webhook.types.d.ts` |
| 8.0kB | `dist/types/webhook.types.d.ts.map` |
| 2.9kB | `dist/utils/currency.d.ts` |
| 680B | `dist/utils/currency.d.ts.map` |
| 4.1kB | `dist/utils/idempotency.d.ts` |
| 1.4kB | `dist/utils/idempotency.d.ts.map` |
| 1.7kB | `dist/utils/logger.d.ts` |
| 813B | `dist/utils/logger.d.ts.map` |
| 6.5kB | `dist/utils/money.d.ts` |
| 2.2kB | `dist/utils/money.d.ts.map` |
| 2.4kB | `dist/utils/retry.d.ts` |
| 966B | `dist/utils/retry.d.ts.map` |
| 6.3kB | `docs/baseline/coverage-policy.md` |
| 7.5kB | `docs/baseline/entry-points.md` |
| 14.5kB | `docs/baseline/package-contents.md` |
| 12.6kB | `docs/baseline/public-api.md` |
| 3.5kB | `docs/baseline/README.md` |
| 27.5kB | `docs/behavioral-contracts.md` |
| 12.4kB | `docs/custom-gateways.md` |
| 2.7kB | `docs/gateway-capabilities.md` |
| 10.9kB | `docs/hooks.md` |
| 3.3kB | `docs/logging.md` |
| 10.4kB | `docs/money.md` |
| 32.2kB | `docs/moyasar.md` |
| 16.3kB | `docs/operation-results.md` |
| 24.0kB | `docs/paymob.md` |
| 29.7kB | `docs/paypal.md` |
| 9.2kB | `docs/plugin-architecture.md` |
| 16.8kB | `docs/runtime.md` |
| 1.9kB | `docs/storage-adapters.md` |
| 31.2kB | `docs/stripe.md` |
| 6.1kB | `docs/telemetry.md` |
| 19.1kB | `docs/webhook-events.md` |
| 14.7kB | `docs/webhooks.md` |
| 1.1kB | `LICENSE` |
| 2.2kB | `package.json` |
| 15.7kB | `README.md` |

**Count**: 116 files

## Notes

- This baseline freezes **what is published**, not payment business logic.
- `docs/baseline/*` generated by Phase 0 will appear in the pack once committed (because `docs` is in `files`).
- Do not add CommonJS dual-publish or change `exports` solely to satisfy packaging tools without treating it as a public contract change.
- Secrets must never appear in fixtures, pack contents, or this document.
