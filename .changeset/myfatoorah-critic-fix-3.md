---
"@paykernel/gateway-myfatoorah": patch
---

Fix critical gateway-myfatoorah review gaps: MF-CREATE-REPLAY now only reuses Paid invoices (Pending falls through — GetPaymentStatus has no PaymentURL, would lose redirect), docs clarify orderId/myfatoorahCustomer.reference required for replay outside KWT/SAU (fallback idempotencyKey removed — was docs-only, would never match invoice CustomerReference); refund headerless retry now `retry:false` (no fan-out to 3 MakeRefund with same ExternalIdentifier); myFatoorahRefundBaseCurrency now only trusts BaseCurrency (no Currency/RefundCurrency fallback that could pick pay currency); mapCreateResult dead invoiceStatus/transactionEvidence removed (PaymentCompleted authoritative per V3).
