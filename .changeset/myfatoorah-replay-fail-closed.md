---
"@paykernel/gateway-myfatoorah": patch
---

Fail closed on MyFatoorah create replay outside KWT/SAU: require `orderId` / `myfatoorahCustomer.reference`; reuse only a Paid invoice whose amount+currency match; Pending, amount mismatch, non-404 lookup errors, and inquiry 5xx/429 return indeterminate instead of a second `/v3/payments`. Also: Paid-without-success stays pending; GetRefundStatus array `Data` is parsed as refund history; webhook host checks use IP literals (not `10.*` hostname prefixes).
