# Package Contents Baseline

> **Phase 0 freeze artifact.** Records the published file set and primary bundle fingerprint.
> Do not hand-edit inventory tables; regenerate with the command below.

## Generation metadata

- **Generated at (UTC)**: 2026-08-14T13:12:13.335Z
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
| `dist/index.js` | 397971 | 388.6 KB | `cd7698d31f78610aff726b960cf9c5096ae3d0109d6bd0ebebb955681485d846` |

Use this hash to detect unintended bundle changes between Phase 0 freezes.

## Simulated package files (from `files` field)

Walk of paths listed in `package.json#files`, plus always-included `package.json`. Sorted by path.

| Path | Bytes |
| --- | ---: |
| `dist/client.d.ts` | 10013 |
| `dist/client.d.ts.map` | 3259 |
| `dist/create-payment-client.d.ts` | 2373 |
| `dist/create-payment-client.d.ts.map` | 1337 |
| `dist/errors.d.ts` | 4330 |
| `dist/errors.d.ts.map` | 2002 |
| `dist/gateways/base.gateway.d.ts` | 4990 |
| `dist/gateways/base.gateway.d.ts.map` | 2210 |
| `dist/gateways/builtin-capabilities.d.ts` | 3510 |
| `dist/gateways/builtin-capabilities.d.ts.map` | 688 |
| `dist/gateways/capabilities-docs.d.ts` | 726 |
| `dist/gateways/capabilities-docs.d.ts.map` | 320 |
| `dist/gateways/factories.d.ts` | 1976 |
| `dist/gateways/factories.d.ts.map` | 806 |
| `dist/gateways/gateway-adapter.d.ts` | 1116 |
| `dist/gateways/gateway-adapter.d.ts.map` | 571 |
| `dist/gateways/gateway-capabilities.d.ts` | 5538 |
| `dist/gateways/gateway-capabilities.d.ts.map` | 908 |
| `dist/gateways/gateway-context.d.ts` | 2792 |
| `dist/gateways/gateway-context.d.ts.map` | 1064 |
| `dist/gateways/gateway-manifest.d.ts` | 1713 |
| `dist/gateways/gateway-manifest.d.ts.map` | 594 |
| `dist/gateways/gateway-registry.d.ts` | 4235 |
| `dist/gateways/gateway-registry.d.ts.map` | 1936 |
| `dist/gateways/gateway.interface.d.ts` | 3981 |
| `dist/gateways/gateway.interface.d.ts.map` | 1561 |
| `dist/gateways/index.d.ts` | 1665 |
| `dist/gateways/index.d.ts.map` | 1190 |
| `dist/gateways/moyasar/moyasar.gateway.d.ts` | 12878 |
| `dist/gateways/moyasar/moyasar.gateway.d.ts.map` | 2571 |
| `dist/gateways/paymob/paymob.gateway.d.ts` | 14745 |
| `dist/gateways/paymob/paymob.gateway.d.ts.map` | 3757 |
| `dist/gateways/paypal/paypal.gateway.d.ts` | 13979 |
| `dist/gateways/paypal/paypal.gateway.d.ts.map` | 3725 |
| `dist/gateways/stripe/stripe.gateway.d.ts` | 6878 |
| `dist/gateways/stripe/stripe.gateway.d.ts.map` | 2519 |
| `dist/hooks/hooks.manager.d.ts` | 3864 |
| `dist/hooks/hooks.manager.d.ts.map` | 1493 |
| `dist/hooks/hooks.types.d.ts` | 6466 |
| `dist/hooks/hooks.types.d.ts.map` | 2858 |
| `dist/index.d.ts` | 9585 |
| `dist/index.d.ts.map` | 5263 |
| `dist/index.js` | 397971 |
| `dist/runtime/abort.d.ts` | 2754 |
| `dist/runtime/abort.d.ts.map` | 1209 |
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
| `dist/types/config.types.d.ts` | 10828 |
| `dist/types/config.types.d.ts.map` | 3878 |
| `dist/types/domain-status.d.ts` | 3251 |
| `dist/types/domain-status.d.ts.map` | 1195 |
| `dist/types/moyasar-source.types.d.ts` | 4993 |
| `dist/types/moyasar-source.types.d.ts.map` | 2404 |
| `dist/types/operation-result.d.ts` | 14733 |
| `dist/types/operation-result.d.ts.map` | 5997 |
| `dist/types/payment-event.d.ts` | 12993 |
| `dist/types/payment-event.d.ts.map` | 6319 |
| `dist/types/payment.types.d.ts` | 22710 |
| `dist/types/payment.types.d.ts.map` | 7506 |
| `dist/types/provider-refs.d.ts` | 3146 |
| `dist/types/provider-refs.d.ts.map` | 1488 |
| `dist/types/stable-payment-event-types.d.ts` | 1143 |
| `dist/types/stable-payment-event-types.d.ts.map` | 367 |
| `dist/types/validation.d.ts` | 233481 |
| `dist/types/validation.d.ts.map` | 7526 |
| `dist/types/webhook-event-map.d.ts` | 5245 |
| `dist/types/webhook-event-map.d.ts.map` | 1488 |
| `dist/types/webhook.types.d.ts` | 13548 |
| `dist/types/webhook.types.d.ts.map` | 7984 |
| `dist/utils/currency.d.ts` | 2859 |
| `dist/utils/currency.d.ts.map` | 679 |
| `dist/utils/idempotency.d.ts` | 4060 |
| `dist/utils/idempotency.d.ts.map` | 1379 |
| `dist/utils/logger.d.ts` | 1586 |
| `dist/utils/logger.d.ts.map` | 811 |
| `dist/utils/money.d.ts` | 6435 |
| `dist/utils/money.d.ts.map` | 2184 |
| `dist/utils/retry.d.ts` | 2409 |
| `dist/utils/retry.d.ts.map` | 966 |
| `docs/baseline/coverage-policy.md` | 6282 |
| `docs/baseline/entry-points.md` | 7498 |
| `docs/baseline/package-contents.md` | 13163 |
| `docs/baseline/phase-0-gate-report.md` | 6183 |
| `docs/baseline/phase-1-gate-report.md` | 10443 |
| `docs/baseline/phase-10-gate-report.md` | 3616 |
| `docs/baseline/phase-11-gate-report.md` | 3597 |
| `docs/baseline/phase-12-gate-report.md` | 2998 |
| `docs/baseline/phase-13-gate-report.md` | 3332 |
| `docs/baseline/phase-14-gate-report.md` | 2898 |
| `docs/baseline/phase-15-gate-report.md` | 3492 |
| `docs/baseline/phase-16-gate-report.md` | 3989 |
| `docs/baseline/phase-17-gate-report.md` | 3903 |
| `docs/baseline/phase-18-gate-report.md` | 12913 |
| `docs/baseline/phase-19-gate-report.md` | 9799 |
| `docs/baseline/phase-2-gate-report.md` | 11299 |
| `docs/baseline/phase-20-gate-report.md` | 8996 |
| `docs/baseline/phase-21-gate-report.md` | 9434 |
| `docs/baseline/phase-3-gate-report.md` | 10261 |
| `docs/baseline/phase-4-gate-report.md` | 11601 |
| `docs/baseline/phase-5-gate-report.md` | 9620 |
| `docs/baseline/phase-6-gate-report.md` | 12225 |
| `docs/baseline/phase-7-gate-report.md` | 12892 |
| `docs/baseline/phase-8-gate-report.md` | 12436 |
| `docs/baseline/phase-9-gate-report.md` | 2680 |
| `docs/baseline/public-api.md` | 12486 |
| `docs/baseline/README.md` | 3493 |
| `docs/behavioral-contracts.md` | 27503 |
| `docs/custom-gateways.md` | 12414 |
| `docs/gateway-capabilities.md` | 2698 |
| `docs/hooks.md` | 10648 |
| `docs/logging.md` | 3272 |
| `docs/money.md` | 9876 |
| `docs/moyasar.md` | 29257 |
| `docs/operation-results.md` | 12368 |
| `docs/paymob.md` | 22205 |
| `docs/paypal.md` | 26774 |
| `docs/plugin-architecture.md` | 9202 |
| `docs/runtime.md` | 16550 |
| `docs/storage-adapters.md` | 1949 |
| `docs/stripe.md` | 25860 |
| `docs/telemetry.md` | 6076 |
| `docs/webhook-events.md` | 17689 |
| `docs/webhooks.md` | 12782 |
| `LICENSE` | 1076 |
| `package.json` | 2184 |
| `README.md` | 15713 |

**Count**: 136 files · **Total bytes**: 1449625 (1.38 MB)

## npm pack --dry-run

### Tarball summary

| Field | Value |
| --- | --- |
| name | `@paykernel/core` |
| version | `0.1.0-next.0` |
| filename | `paykernel-core-0.1.0-next.0.tgz` |
| package size | `316.9 kB` |
| unpacked size | `1.4 MB` |
| shasum | `2b12019a1760e36068cd192ea2ffecaeee66cdb9` |
| integrity | `sha512-sO7/CuiR1lWEU[...]VAeHA0Txnwh9A==` |
| total files | `136` |
| Changelog | `https://github.com/npm/cli/releases/tag/v11.19.0` |
| To update run | `npm install -g npm@11.19.0` |

### Tarball file list (sorted by path)

| Size (npm) | Path |
| --- | --- |
| 10.0kB | `dist/client.d.ts` |
| 3.3kB | `dist/client.d.ts.map` |
| 2.4kB | `dist/create-payment-client.d.ts` |
| 1.3kB | `dist/create-payment-client.d.ts.map` |
| 4.3kB | `dist/errors.d.ts` |
| 2.0kB | `dist/errors.d.ts.map` |
| 5.0kB | `dist/gateways/base.gateway.d.ts` |
| 2.2kB | `dist/gateways/base.gateway.d.ts.map` |
| 3.5kB | `dist/gateways/builtin-capabilities.d.ts` |
| 688B | `dist/gateways/builtin-capabilities.d.ts.map` |
| 726B | `dist/gateways/capabilities-docs.d.ts` |
| 320B | `dist/gateways/capabilities-docs.d.ts.map` |
| 2.0kB | `dist/gateways/factories.d.ts` |
| 806B | `dist/gateways/factories.d.ts.map` |
| 1.1kB | `dist/gateways/gateway-adapter.d.ts` |
| 571B | `dist/gateways/gateway-adapter.d.ts.map` |
| 5.5kB | `dist/gateways/gateway-capabilities.d.ts` |
| 908B | `dist/gateways/gateway-capabilities.d.ts.map` |
| 2.8kB | `dist/gateways/gateway-context.d.ts` |
| 1.1kB | `dist/gateways/gateway-context.d.ts.map` |
| 1.7kB | `dist/gateways/gateway-manifest.d.ts` |
| 594B | `dist/gateways/gateway-manifest.d.ts.map` |
| 4.2kB | `dist/gateways/gateway-registry.d.ts` |
| 1.9kB | `dist/gateways/gateway-registry.d.ts.map` |
| 4.0kB | `dist/gateways/gateway.interface.d.ts` |
| 1.6kB | `dist/gateways/gateway.interface.d.ts.map` |
| 1.7kB | `dist/gateways/index.d.ts` |
| 1.2kB | `dist/gateways/index.d.ts.map` |
| 12.9kB | `dist/gateways/moyasar/moyasar.gateway.d.ts` |
| 2.6kB | `dist/gateways/moyasar/moyasar.gateway.d.ts.map` |
| 14.7kB | `dist/gateways/paymob/paymob.gateway.d.ts` |
| 3.8kB | `dist/gateways/paymob/paymob.gateway.d.ts.map` |
| 14.0kB | `dist/gateways/paypal/paypal.gateway.d.ts` |
| 3.7kB | `dist/gateways/paypal/paypal.gateway.d.ts.map` |
| 6.9kB | `dist/gateways/stripe/stripe.gateway.d.ts` |
| 2.5kB | `dist/gateways/stripe/stripe.gateway.d.ts.map` |
| 3.9kB | `dist/hooks/hooks.manager.d.ts` |
| 1.5kB | `dist/hooks/hooks.manager.d.ts.map` |
| 6.5kB | `dist/hooks/hooks.types.d.ts` |
| 2.9kB | `dist/hooks/hooks.types.d.ts.map` |
| 9.6kB | `dist/index.d.ts` |
| 5.3kB | `dist/index.d.ts.map` |
| 398.0kB | `dist/index.js` |
| 2.8kB | `dist/runtime/abort.d.ts` |
| 1.2kB | `dist/runtime/abort.d.ts.map` |
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
| 10.8kB | `dist/types/config.types.d.ts` |
| 3.9kB | `dist/types/config.types.d.ts.map` |
| 3.3kB | `dist/types/domain-status.d.ts` |
| 1.2kB | `dist/types/domain-status.d.ts.map` |
| 5.0kB | `dist/types/moyasar-source.types.d.ts` |
| 2.4kB | `dist/types/moyasar-source.types.d.ts.map` |
| 14.7kB | `dist/types/operation-result.d.ts` |
| 6.0kB | `dist/types/operation-result.d.ts.map` |
| 13.0kB | `dist/types/payment-event.d.ts` |
| 6.3kB | `dist/types/payment-event.d.ts.map` |
| 22.7kB | `dist/types/payment.types.d.ts` |
| 7.5kB | `dist/types/payment.types.d.ts.map` |
| 3.1kB | `dist/types/provider-refs.d.ts` |
| 1.5kB | `dist/types/provider-refs.d.ts.map` |
| 1.1kB | `dist/types/stable-payment-event-types.d.ts` |
| 367B | `dist/types/stable-payment-event-types.d.ts.map` |
| 233.5kB | `dist/types/validation.d.ts` |
| 7.5kB | `dist/types/validation.d.ts.map` |
| 5.2kB | `dist/types/webhook-event-map.d.ts` |
| 1.5kB | `dist/types/webhook-event-map.d.ts.map` |
| 13.5kB | `dist/types/webhook.types.d.ts` |
| 8.0kB | `dist/types/webhook.types.d.ts.map` |
| 2.9kB | `dist/utils/currency.d.ts` |
| 679B | `dist/utils/currency.d.ts.map` |
| 4.1kB | `dist/utils/idempotency.d.ts` |
| 1.4kB | `dist/utils/idempotency.d.ts.map` |
| 1.6kB | `dist/utils/logger.d.ts` |
| 811B | `dist/utils/logger.d.ts.map` |
| 6.4kB | `dist/utils/money.d.ts` |
| 2.2kB | `dist/utils/money.d.ts.map` |
| 2.4kB | `dist/utils/retry.d.ts` |
| 966B | `dist/utils/retry.d.ts.map` |
| 6.3kB | `docs/baseline/coverage-policy.md` |
| 7.5kB | `docs/baseline/entry-points.md` |
| 13.2kB | `docs/baseline/package-contents.md` |
| 6.2kB | `docs/baseline/phase-0-gate-report.md` |
| 10.4kB | `docs/baseline/phase-1-gate-report.md` |
| 3.6kB | `docs/baseline/phase-10-gate-report.md` |
| 3.6kB | `docs/baseline/phase-11-gate-report.md` |
| 3.0kB | `docs/baseline/phase-12-gate-report.md` |
| 3.3kB | `docs/baseline/phase-13-gate-report.md` |
| 2.9kB | `docs/baseline/phase-14-gate-report.md` |
| 3.5kB | `docs/baseline/phase-15-gate-report.md` |
| 4.0kB | `docs/baseline/phase-16-gate-report.md` |
| 3.9kB | `docs/baseline/phase-17-gate-report.md` |
| 12.9kB | `docs/baseline/phase-18-gate-report.md` |
| 9.8kB | `docs/baseline/phase-19-gate-report.md` |
| 11.3kB | `docs/baseline/phase-2-gate-report.md` |
| 9.0kB | `docs/baseline/phase-20-gate-report.md` |
| 9.4kB | `docs/baseline/phase-21-gate-report.md` |
| 10.3kB | `docs/baseline/phase-3-gate-report.md` |
| 11.6kB | `docs/baseline/phase-4-gate-report.md` |
| 9.6kB | `docs/baseline/phase-5-gate-report.md` |
| 12.2kB | `docs/baseline/phase-6-gate-report.md` |
| 12.9kB | `docs/baseline/phase-7-gate-report.md` |
| 12.4kB | `docs/baseline/phase-8-gate-report.md` |
| 2.7kB | `docs/baseline/phase-9-gate-report.md` |
| 12.5kB | `docs/baseline/public-api.md` |
| 3.5kB | `docs/baseline/README.md` |
| 27.5kB | `docs/behavioral-contracts.md` |
| 12.4kB | `docs/custom-gateways.md` |
| 2.7kB | `docs/gateway-capabilities.md` |
| 10.6kB | `docs/hooks.md` |
| 3.3kB | `docs/logging.md` |
| 9.9kB | `docs/money.md` |
| 29.3kB | `docs/moyasar.md` |
| 12.4kB | `docs/operation-results.md` |
| 22.2kB | `docs/paymob.md` |
| 26.8kB | `docs/paypal.md` |
| 9.2kB | `docs/plugin-architecture.md` |
| 16.6kB | `docs/runtime.md` |
| 1.9kB | `docs/storage-adapters.md` |
| 25.9kB | `docs/stripe.md` |
| 6.1kB | `docs/telemetry.md` |
| 17.7kB | `docs/webhook-events.md` |
| 12.8kB | `docs/webhooks.md` |
| 1.1kB | `LICENSE` |
| 2.2kB | `package.json` |
| 15.7kB | `README.md` |

**Count**: 136 files

## Notes

- This baseline freezes **what is published**, not payment business logic.
- `docs/baseline/*` generated by Phase 0 will appear in the pack once committed (because `docs` is in `files`).
- Do not add CommonJS dual-publish or change `exports` solely to satisfy packaging tools without treating it as a public contract change.
- Secrets must never appear in fixtures, pack contents, or this document.
