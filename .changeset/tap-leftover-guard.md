---
"@paykernel/core": patch
"@paykernel/gateway-tap": patch
---

Type `createPayment` / `capturePayment` / `refundPayment` from the client's default gateway (map and registry) without putting extra-package fields on core params. Tap omitted-amount remaining math fail-closes on mixed refund lists; nested refund replay matches `reference.idempotent`.
