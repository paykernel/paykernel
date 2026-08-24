---
"@paykernel/gateway-myfatoorah": patch
---

Fix remaining gateway-myfatoorah review gaps: create-replay only outside KWT/SAU and only when Paid amount+currency match (inquiry 5xx/429 fail closed); headerless create/refund retry only on “header not supported” (MakeRefund `retry: false`); parse official thousand-separated amounts; refund PaymentId key type; PARTIALLY_REFUNDED → partially_refunded.
