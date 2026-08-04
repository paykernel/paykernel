---
title: Pay with PayPal for vaulted payments
slug: /docs/checkout/standard/best-practices/vault/
createTime: '2025-01-23T17:22:17.793Z'
updateTime: '2025-09-17T11:38:37.960Z'
---


# Pay with PayPal for vaulted payments

![Three,smartphjone,screenshots,demonstrating,a,simplified,onboarding,integration,for,vaulted,payments.](https://www.paypalobjects.com/devdoc/best-practices/screenshot_vault-onboarding_combined.png)

**End-to-end vaulted payments flow**



Pay with PayPal's Vaulted Payments flow provides a seamless checkout experience by storing payment methods for high-frequency and low average-order-value services such as rides, meal pickups, and other quick purchases.

This flow is recommended for business models where the average transaction size is less than $40. For business models where the customer actively initiates a purchase and the purchase does not involve a recurring payment, we recommend [One-time payments](/docs/checkout/standard/best-practices/one-time/) .



## Purpose
This guide provides best practices for merchants who want to store PayPal as a payment method and streamline repeat transactions in mobile-first scenarios such as ordering food or taking a ride.

Using these tips to support online-to-offline (O2O) use cases makes it easier for your customers to confidently save, manage, and use PayPal for frictionless repeat transactions.





## Who is this guide for?
This guide is for developers, designers, and product managers building mobile payment flows for businesses providing O2O services such as ride-hailing, food delivery, and quick-service dining. Customers typically use their phones to start a transaction on a merchant's app and then complete the payment using the PayPal app.



## Best practices for implementing PayPal Vaulted Payments
Preselecting PayPal for PayPal users and supportingfrictionless login on native experiences can streamline the login process and optimize checkout so customers have an easier time making purchases.



## Preselect PayPal for payment-ready PayPal users at onboarding
PayPal Vaulted Payments simplify O2O transactions by allowing users to save and manage their payment methods securely.

-  **Use the latest PayPal marks and logos** :Maintain brand trust and consistency by displaying updated PayPal branding.
-  **Identify active PayPal users** :During onboarding, use PayPal APIs to determine if a customer has a valid payment method saved in their PayPal wallet.
-  **Preselect PayPal for active users** :Drive higher conversions by selecting PayPal as the default payment option for identified users.
-  **Pass user contact information** :When initiating the PayPal flow, share customer contact details with PayPal for a smoother and more personalized experience.


![screenshot_vaulted-payments_01_onboarding.png](https://paypalobjects.com/devdoc/best-practices/screenshot_vaulted-payments_01_onboarding.png)


## Enable frictionless login across all surfaces
Enhance user experience and streamline login processes by implementing PayPal's frictionless login features for native experiences. Enabling support for App Switch can optimize the checkout experience, provide smoother transitions between apps, and ensure secure, efficient customer logins.

-  **Native Apps** :Use the PayPal Native SDK to enable [low-friction login experiences](/sdk/mobile/) in fully native apps.
-  **Hybrid Apps** : Implement the PopUp Bridge SDK for apps that use a website inside the app to provide secure web views for PayPal.
- **Websites:** Support for [App Switch](/docs/checkout/standard/customize/app-switch) in the PayPal JavascriptSDK is coming soon.
-  **Non-SDK Merchants** : Set up seamless integration by manually rendering PayPal in a secure webview, such as AS-WAS on iOS or CCT on Android.


![screenshot_vaulted-payments_frictionless-login_combined.png](https://paypalobjects.com/devdoc/best-practices/screenshot_vaulted-payments_frictionless-login_combined.png)


## Next steps

### App Switch
Streamline checkout by helping buyers finish transactions in the PayPal app.

