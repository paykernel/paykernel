---
"@paykernel/gateway-myfatoorah": patch
---

Fix MyFatoorah create-replay and unkeyed mutation retries: official 2xx GetPaymentStatus not-found (`IsSuccess:false` + empty Data + not-found Message) may create; empty success Data and generic IsSuccess-false fail closed; pending/mismatch indeterminate keeps the InvoiceId; unkeyed create/MakeRefund no longer retry 429.
