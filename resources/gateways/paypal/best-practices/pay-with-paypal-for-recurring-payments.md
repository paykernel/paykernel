---
title: Pay with PayPal for recurring payments
slug: /docs/checkout/standard/best-practices/recurring/
createTime: '2025-01-09T21:31:27.191Z'
updateTime: '2025-08-12T17:39:06.171Z'
---


# Pay with PayPal for recurring payments

The recurring payment module helps display recurring payment information to the payer before they commit to the payment. This can increase payer conversion by building customer trust through transparency.

Pay with PayPal supports saving payment methods, enabling merchants to charge payers on a recurring basis through the following integration patterns.



Recurring payment setup without purchase:

- Collect and securely save a customer’s payment method before their first purchase. Useful for free trials, postpaid services, or scenarios where the initial transaction doesn’t require immediate payment. Charges can be initiated by the merchant at a later date without requiring the customer’s presence. For more information, see [Save payment methods for purchase later](https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/) .



Save payment methods during purchase:

- During the customer's initial purchase or subscription setup, process the payment and save the customer’s payment method in one step using the [Orders v2 API](https://developer.paypal.com/docs/api/orders/v2/) . This records the customer's consent to future charges as part of the same transaction. Do not use standalone Payment Method or Token APIs for these scenarios.

        For implementation details, see [Save payment methods for recurring payments](https://developer.paypal.com/docs/checkout/standard/customize/save-payment-methods-for-recurring-payments/) .



Both integration patterns support two customer flows:

- Pay Now: Collect payment and save the customer’s payment method in one step.
- Setup Now: Save the payment method for future use without charging the customer immediately.

Choose the integration pattern and flow that best fit your business needs. You control when to charge your customers and how to deliver a seamless recurring payment experience.

![Three,smartphone,screenshots,demonstrating,a,simplified,subscription,sign-up,integration,for,recurring,payments.](https://www.paypalobjects.com/devdoc/best-practices/screenshot_recurring-payments_subscription_combined.png)

**End-to-end recurring payments flow**



### Purpose
This guide provides best practices for creating a seamless experience for customers who want to set up automatic payments with PayPal Checkout. By following these guidelines, you can simplify the process of subscribing to a service, trying it out, or automatically reloading an account, making it easier for customers to manage their payments.



### Who is this guide for?
Use this documentation if you are a digital service provider or a member of a technical team managing recurring billing services. Examples include digital media platforms, content subscriptions, and other SaaS companies. Typically, the buyer has an existing account and shipping address on file with the merchant.



## Best practices for implementing recurring payments PayPal review page
PayPal offers a recurring payments review page to show the customer information about the recurring payments for their subscription or other purchase. Setting up the PayPal review page correctly can help you streamline recurring payments, simplify subscription management, and reduce disputes.

- Ensure that the order card shows plan information and a recurring indicator for greater transparency. The buyer can review this information on the PayPal review page before accepting the terms. See [Save payment methods for recurring payments](https://developer.paypal.com/docs/checkout/standard/customize/save-payment-methods-for-recurring-payments/) for more information.


- If you have the buyer's email address, pass it during order creation. See the [Pass buyer identifier](/docs/checkout/standard/customize/pass-buyer-identifier/) guide for more information.




![screenshot_recurring-payments_example-implementation.png](https://paypalobjects.com/devdoc/best-practices/screenshot_recurring-payments_example-implementation.png)


## Best practices for saving payment methods during purchase
Integrate a [Shipping module](https://developer.paypal.com/docs/checkout/standard/customize/shipping-module/) to capture shipping addresses during the first purchase when recurring payments involve physical goods.

- Show delivery estimates up front so customers know when to expect their items.
- For digital goods and services, ensure you send PayPal the correct address and delivery context to match your fulfillment process.

Set up server-side webhooks or callbacks to receive real-time updates on subscription status, such as failed payments, expired methods, or cancellations.

- Sync billing events with your system to manage access, fulfillment, and customer communication. Use automated processes to handle payment retries or grace periods.



## Next steps

### Pass buyer identifier
Prefill a buyer's PayPal login page by passing their email address.


### Recurring payments module
Display recurring payment information to the payer before they commit to the payment.

