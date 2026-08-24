---
"@paykernel/gateway-myfatoorah": patch
---

Fix MyFatoorah deep-review findings: first refund infers account base currency from portal country (fail-closed on pay-currency amounts); nullable `GetRefundStatus` `Data` treated as empty history; headerless idempotency-error create retry runs without post-submit auto-retry; `getPayment` publishes pay-currency amount; refund webhook `paymentId` only from `ReferencedInvoice.ExternalIdentifier`; V3 `PaymentMethod` allowlist restricted to CARD/APPLE_PAY/GOOGLE_PAY/KNET/INVOICE; `KD`/`SR` webhook currency aliases; signature header accepts string arrays; localhost callback/webhook URLs rejected.
