# Package Contents Baseline

> **Phase 0 freeze artifact.** Records the published file set and primary bundle fingerprint.
> Do not hand-edit inventory tables; regenerate with the command below.

## Generation metadata

- **Generated at (UTC)**: 2026-08-03T03:52:05.393Z
- **Command**: `bun run scripts/record-package-baseline.ts`
- **Package**: `@paykernel/core@0.8.0`

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
| `dist/index.js` | 326013 | 318.4 KB | `fa14b67da61f147a6aa251e263a306a3fadc0773f26123060cf8d2fcf82c081a` |

Use this hash to detect unintended bundle changes between Phase 0 freezes.

## Simulated package files (from `files` field)

Walk of paths listed in `package.json#files`, plus always-included `package.json`. Sorted by path.

| Path | Bytes |
| --- | ---: |
| `dist/client.d.ts` | 9718 |
| `dist/client.d.ts.map` | 3222 |
| `dist/create-payment-client.d.ts` | 2373 |
| `dist/create-payment-client.d.ts.map` | 1337 |
| `dist/errors.d.ts` | 4330 |
| `dist/errors.d.ts.map` | 2002 |
| `dist/gateways/base.gateway.d.ts` | 4990 |
| `dist/gateways/base.gateway.d.ts.map` | 2210 |
| `dist/gateways/builtin-capabilities.d.ts` | 3518 |
| `dist/gateways/builtin-capabilities.d.ts.map` | 686 |
| `dist/gateways/capabilities-docs.d.ts` | 726 |
| `dist/gateways/capabilities-docs.d.ts.map` | 320 |
| `dist/gateways/factories.d.ts` | 1976 |
| `dist/gateways/factories.d.ts.map` | 806 |
| `dist/gateways/gateway-adapter.d.ts` | 1116 |
| `dist/gateways/gateway-adapter.d.ts.map` | 571 |
| `dist/gateways/gateway-capabilities.d.ts` | 5272 |
| `dist/gateways/gateway-capabilities.d.ts.map` | 903 |
| `dist/gateways/gateway-context.d.ts` | 2447 |
| `dist/gateways/gateway-context.d.ts.map` | 1078 |
| `dist/gateways/gateway-manifest.d.ts` | 1713 |
| `dist/gateways/gateway-manifest.d.ts.map` | 594 |
| `dist/gateways/gateway-registry.d.ts` | 4235 |
| `dist/gateways/gateway-registry.d.ts.map` | 1936 |
| `dist/gateways/gateway.interface.d.ts` | 3981 |
| `dist/gateways/gateway.interface.d.ts.map` | 1561 |
| `dist/gateways/index.d.ts` | 1634 |
| `dist/gateways/index.d.ts.map` | 1176 |
| `dist/gateways/moyasar/moyasar.gateway.d.ts` | 9429 |
| `dist/gateways/moyasar/moyasar.gateway.d.ts.map` | 2372 |
| `dist/gateways/paymob/paymob.gateway.d.ts` | 10033 |
| `dist/gateways/paymob/paymob.gateway.d.ts.map` | 3485 |
| `dist/gateways/paypal/paypal.gateway.d.ts` | 8593 |
| `dist/gateways/paypal/paypal.gateway.d.ts.map` | 3118 |
| `dist/gateways/stripe/stripe.gateway.d.ts` | 5026 |
| `dist/gateways/stripe/stripe.gateway.d.ts.map` | 2402 |
| `dist/hooks/hooks.manager.d.ts` | 3147 |
| `dist/hooks/hooks.manager.d.ts.map` | 1333 |
| `dist/hooks/hooks.types.d.ts` | 6466 |
| `dist/hooks/hooks.types.d.ts.map` | 2858 |
| `dist/hooks/index.d.ts` | 114 |
| `dist/hooks/index.d.ts.map` | 175 |
| `dist/index.d.ts` | 10103 |
| `dist/index.d.ts.map` | 5637 |
| `dist/index.js` | 326013 |
| `dist/runtime/abort.d.ts` | 2754 |
| `dist/runtime/abort.d.ts.map` | 1209 |
| `dist/runtime/clock.d.ts` | 360 |
| `dist/runtime/clock.d.ts.map` | 253 |
| `dist/runtime/crypto-portable.d.ts` | 2515 |
| `dist/runtime/crypto-portable.d.ts.map` | 1519 |
| `dist/runtime/crypto-provider.d.ts` | 1085 |
| `dist/runtime/crypto-provider.d.ts.map` | 454 |
| `dist/runtime/index.d.ts` | 1028 |
| `dist/runtime/index.d.ts.map` | 806 |
| `dist/runtime/payment-runtime.d.ts` | 1769 |
| `dist/runtime/payment-runtime.d.ts.map` | 726 |
| `dist/types/config.types.d.ts` | 10824 |
| `dist/types/config.types.d.ts.map` | 3883 |
| `dist/types/domain-status.d.ts` | 2966 |
| `dist/types/domain-status.d.ts.map` | 1192 |
| `dist/types/index.d.ts` | 305 |
| `dist/types/index.d.ts.map` | 295 |
| `dist/types/moyasar-source.types.d.ts` | 4993 |
| `dist/types/moyasar-source.types.d.ts.map` | 2404 |
| `dist/types/operation-result.d.ts` | 11445 |
| `dist/types/operation-result.d.ts.map` | 5470 |
| `dist/types/payment-event.d.ts` | 11559 |
| `dist/types/payment-event.d.ts.map` | 6296 |
| `dist/types/payment.types.d.ts` | 22158 |
| `dist/types/payment.types.d.ts.map` | 7447 |
| `dist/types/provider-refs.d.ts` | 3146 |
| `dist/types/provider-refs.d.ts.map` | 1488 |
| `dist/types/stable-payment-event-types.d.ts` | 1143 |
| `dist/types/stable-payment-event-types.d.ts.map` | 367 |
| `dist/types/validation.d.ts` | 235452 |
| `dist/types/validation.d.ts.map` | 8445 |
| `dist/types/webhook-event-map.d.ts` | 3803 |
| `dist/types/webhook-event-map.d.ts.map` | 1329 |
| `dist/types/webhook.types.d.ts` | 13548 |
| `dist/types/webhook.types.d.ts.map` | 7984 |
| `dist/utils/currency.d.ts` | 1913 |
| `dist/utils/currency.d.ts.map` | 453 |
| `dist/utils/idempotency.d.ts` | 3342 |
| `dist/utils/idempotency.d.ts.map` | 1409 |
| `dist/utils/logger.d.ts` | 1429 |
| `dist/utils/logger.d.ts.map` | 807 |
| `dist/utils/money.d.ts` | 5690 |
| `dist/utils/money.d.ts.map` | 2121 |
| `dist/utils/retry.d.ts` | 2409 |
| `dist/utils/retry.d.ts.map` | 966 |
| `docs/baseline/coverage-policy.md` | 6289 |
| `docs/baseline/entry-points.md` | 7515 |
| `docs/baseline/package-contents.md` | 15234 |
| `docs/baseline/phase-0-gate-report.md` | 6190 |
| `docs/baseline/phase-1-gate-report.md` | 10567 |
| `docs/baseline/phase-10-gate-report.md` | 3395 |
| `docs/baseline/phase-2-gate-report.md` | 11335 |
| `docs/baseline/phase-3-gate-report.md` | 10297 |
| `docs/baseline/phase-4-gate-report.md` | 11670 |
| `docs/baseline/phase-5-gate-report.md` | 9604 |
| `docs/baseline/phase-6-gate-report.md` | 12270 |
| `docs/baseline/phase-7-gate-report.md` | 12937 |
| `docs/baseline/phase-8-gate-report.md` | 12481 |
| `docs/baseline/phase-9-gate-report.md` | 3348 |
| `docs/baseline/public-api.md` | 12039 |
| `docs/baseline/README.md` | 3500 |
| `docs/behavioral-contracts.md` | 25989 |
| `docs/custom-gateways.md` | 12159 |
| `docs/gateway-capabilities.md` | 2420 |
| `docs/hooks.md` | 10194 |
| `docs/logging.md` | 2674 |
| `docs/money.md` | 7849 |
| `docs/moyasar.md` | 22974 |
| `docs/operation-results.md` | 10397 |
| `docs/paymob.md` | 13714 |
| `docs/paypal.md` | 18840 |
| `docs/plugin-architecture.md` | 9226 |
| `docs/runtime.md` | 13255 |
| `docs/stripe.md` | 20133 |
| `docs/webhook-events.md` | 12761 |
| `docs/webhooks.md` | 12158 |
| `LICENSE` | 1076 |
| `package.json` | 2044 |
| `README.md` | 15322 |

**Count**: 125 files · **Total bytes**: 1231550 (1.17 MB)

## npm pack --dry-run

### Tarball summary

| Field | Value |
| --- | --- |
| name | `@paykernel/core` |
| version | `0.8.0` |
| filename | `abshahin-payments-sdk-0.8.0.tgz` |
| package size | `261.3 kB` |
| unpacked size | `1.2 MB` |
| shasum | `1de8a6cb4d9c1daca4b1faf3162a58e20aa607ad` |
| integrity | `sha512-0OA70gF92KIO+[...]Eay87sR66fBGA==` |
| total files | `125` |

### Tarball file list (sorted by path)

| Size (npm) | Path |
| --- | --- |
| 9.7kB | `dist/client.d.ts` |
| 3.2kB | `dist/client.d.ts.map` |
| 2.4kB | `dist/create-payment-client.d.ts` |
| 1.3kB | `dist/create-payment-client.d.ts.map` |
| 4.3kB | `dist/errors.d.ts` |
| 2.0kB | `dist/errors.d.ts.map` |
| 5.0kB | `dist/gateways/base.gateway.d.ts` |
| 2.2kB | `dist/gateways/base.gateway.d.ts.map` |
| 3.5kB | `dist/gateways/builtin-capabilities.d.ts` |
| 686B | `dist/gateways/builtin-capabilities.d.ts.map` |
| 726B | `dist/gateways/capabilities-docs.d.ts` |
| 320B | `dist/gateways/capabilities-docs.d.ts.map` |
| 2.0kB | `dist/gateways/factories.d.ts` |
| 806B | `dist/gateways/factories.d.ts.map` |
| 1.1kB | `dist/gateways/gateway-adapter.d.ts` |
| 571B | `dist/gateways/gateway-adapter.d.ts.map` |
| 5.3kB | `dist/gateways/gateway-capabilities.d.ts` |
| 903B | `dist/gateways/gateway-capabilities.d.ts.map` |
| 2.4kB | `dist/gateways/gateway-context.d.ts` |
| 1.1kB | `dist/gateways/gateway-context.d.ts.map` |
| 1.7kB | `dist/gateways/gateway-manifest.d.ts` |
| 594B | `dist/gateways/gateway-manifest.d.ts.map` |
| 4.2kB | `dist/gateways/gateway-registry.d.ts` |
| 1.9kB | `dist/gateways/gateway-registry.d.ts.map` |
| 4.0kB | `dist/gateways/gateway.interface.d.ts` |
| 1.6kB | `dist/gateways/gateway.interface.d.ts.map` |
| 1.6kB | `dist/gateways/index.d.ts` |
| 1.2kB | `dist/gateways/index.d.ts.map` |
| 9.4kB | `dist/gateways/moyasar/moyasar.gateway.d.ts` |
| 2.4kB | `dist/gateways/moyasar/moyasar.gateway.d.ts.map` |
| 10.0kB | `dist/gateways/paymob/paymob.gateway.d.ts` |
| 3.5kB | `dist/gateways/paymob/paymob.gateway.d.ts.map` |
| 8.6kB | `dist/gateways/paypal/paypal.gateway.d.ts` |
| 3.1kB | `dist/gateways/paypal/paypal.gateway.d.ts.map` |
| 5.0kB | `dist/gateways/stripe/stripe.gateway.d.ts` |
| 2.4kB | `dist/gateways/stripe/stripe.gateway.d.ts.map` |
| 3.1kB | `dist/hooks/hooks.manager.d.ts` |
| 1.3kB | `dist/hooks/hooks.manager.d.ts.map` |
| 6.5kB | `dist/hooks/hooks.types.d.ts` |
| 2.9kB | `dist/hooks/hooks.types.d.ts.map` |
| 114B | `dist/hooks/index.d.ts` |
| 175B | `dist/hooks/index.d.ts.map` |
| 10.1kB | `dist/index.d.ts` |
| 5.6kB | `dist/index.d.ts.map` |
| 326.0kB | `dist/index.js` |
| 2.8kB | `dist/runtime/abort.d.ts` |
| 1.2kB | `dist/runtime/abort.d.ts.map` |
| 360B | `dist/runtime/clock.d.ts` |
| 253B | `dist/runtime/clock.d.ts.map` |
| 2.5kB | `dist/runtime/crypto-portable.d.ts` |
| 1.5kB | `dist/runtime/crypto-portable.d.ts.map` |
| 1.1kB | `dist/runtime/crypto-provider.d.ts` |
| 454B | `dist/runtime/crypto-provider.d.ts.map` |
| 1.0kB | `dist/runtime/index.d.ts` |
| 806B | `dist/runtime/index.d.ts.map` |
| 1.8kB | `dist/runtime/payment-runtime.d.ts` |
| 726B | `dist/runtime/payment-runtime.d.ts.map` |
| 10.8kB | `dist/types/config.types.d.ts` |
| 3.9kB | `dist/types/config.types.d.ts.map` |
| 3.0kB | `dist/types/domain-status.d.ts` |
| 1.2kB | `dist/types/domain-status.d.ts.map` |
| 305B | `dist/types/index.d.ts` |
| 295B | `dist/types/index.d.ts.map` |
| 5.0kB | `dist/types/moyasar-source.types.d.ts` |
| 2.4kB | `dist/types/moyasar-source.types.d.ts.map` |
| 11.4kB | `dist/types/operation-result.d.ts` |
| 5.5kB | `dist/types/operation-result.d.ts.map` |
| 11.6kB | `dist/types/payment-event.d.ts` |
| 6.3kB | `dist/types/payment-event.d.ts.map` |
| 22.2kB | `dist/types/payment.types.d.ts` |
| 7.4kB | `dist/types/payment.types.d.ts.map` |
| 3.1kB | `dist/types/provider-refs.d.ts` |
| 1.5kB | `dist/types/provider-refs.d.ts.map` |
| 1.1kB | `dist/types/stable-payment-event-types.d.ts` |
| 367B | `dist/types/stable-payment-event-types.d.ts.map` |
| 235.5kB | `dist/types/validation.d.ts` |
| 8.4kB | `dist/types/validation.d.ts.map` |
| 3.8kB | `dist/types/webhook-event-map.d.ts` |
| 1.3kB | `dist/types/webhook-event-map.d.ts.map` |
| 13.5kB | `dist/types/webhook.types.d.ts` |
| 8.0kB | `dist/types/webhook.types.d.ts.map` |
| 1.9kB | `dist/utils/currency.d.ts` |
| 453B | `dist/utils/currency.d.ts.map` |
| 3.3kB | `dist/utils/idempotency.d.ts` |
| 1.4kB | `dist/utils/idempotency.d.ts.map` |
| 1.4kB | `dist/utils/logger.d.ts` |
| 807B | `dist/utils/logger.d.ts.map` |
| 5.7kB | `dist/utils/money.d.ts` |
| 2.1kB | `dist/utils/money.d.ts.map` |
| 2.4kB | `dist/utils/retry.d.ts` |
| 966B | `dist/utils/retry.d.ts.map` |
| 6.3kB | `docs/baseline/coverage-policy.md` |
| 7.5kB | `docs/baseline/entry-points.md` |
| 15.2kB | `docs/baseline/package-contents.md` |
| 6.2kB | `docs/baseline/phase-0-gate-report.md` |
| 10.6kB | `docs/baseline/phase-1-gate-report.md` |
| 3.4kB | `docs/baseline/phase-10-gate-report.md` |
| 11.3kB | `docs/baseline/phase-2-gate-report.md` |
| 10.3kB | `docs/baseline/phase-3-gate-report.md` |
| 11.7kB | `docs/baseline/phase-4-gate-report.md` |
| 9.6kB | `docs/baseline/phase-5-gate-report.md` |
| 12.3kB | `docs/baseline/phase-6-gate-report.md` |
| 12.9kB | `docs/baseline/phase-7-gate-report.md` |
| 12.5kB | `docs/baseline/phase-8-gate-report.md` |
| 3.3kB | `docs/baseline/phase-9-gate-report.md` |
| 12.0kB | `docs/baseline/public-api.md` |
| 3.5kB | `docs/baseline/README.md` |
| 26.0kB | `docs/behavioral-contracts.md` |
| 12.2kB | `docs/custom-gateways.md` |
| 2.4kB | `docs/gateway-capabilities.md` |
| 10.2kB | `docs/hooks.md` |
| 2.7kB | `docs/logging.md` |
| 7.8kB | `docs/money.md` |
| 23.0kB | `docs/moyasar.md` |
| 10.4kB | `docs/operation-results.md` |
| 13.7kB | `docs/paymob.md` |
| 18.8kB | `docs/paypal.md` |
| 9.2kB | `docs/plugin-architecture.md` |
| 13.3kB | `docs/runtime.md` |
| 20.1kB | `docs/stripe.md` |
| 12.8kB | `docs/webhook-events.md` |
| 12.2kB | `docs/webhooks.md` |
| 1.1kB | `LICENSE` |
| 2.0kB | `package.json` |
| 15.3kB | `README.md` |

**Count**: 125 files

## Notes

- This baseline freezes **what is published**, not payment business logic.
- `docs/baseline/*` generated by Phase 0 will appear in the pack once committed (because `docs` is in `files`).
- Do not add CommonJS dual-publish or change `exports` solely to satisfy packaging tools without treating it as a public contract change.
- Secrets must never appear in fixtures, pack contents, or this document.
