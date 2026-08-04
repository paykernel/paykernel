---
title: Pay with PayPal for one-time payments
slug: /docs/checkout/standard/best-practices/one-time/
createTime: '2025-01-09T00:39:31.952Z'
updateTime: '2025-09-17T12:05:30.686Z'
---


# Pay with PayPal for one-time payments

Pay with PayPal's one-time payment flow provides a one-click solution to accelerate your buyer's checkout experience by skipping manual data entry.

![Four,smartphone,screenshots,demonstrating,a,one-click,checkout,integration,with,one-time,payments,for,retail,purchases.](https://www.paypalobjects.com/devdoc/QLBPOne_Time_Pymts.png)

**End-to-end one-time payments flow**



### Purpose
This guide shows best practices for merchants using Pay with PayPal to accept one-time payments for physical and digital goods. Setting up the PayPal button and PayPal review page using these tips can help improve engagement, reduce cart abandonment, and ensure a secure transaction experience.



### Who is this guide for?
Developers, designers, and product managers building ecommerce solutions for businesses selling physical goods, including retail, apparel, electronics, and other tangible products.



## Best practices for end-to-end Pay with PayPal buyer experience
The PayPal button and PayPal review page help you accept one-time payments. This guide shows how to present the PayPal button and PayPal review page to improve the buyer flow.



## Presenting the PayPal button
Buyers can use PayPal to check out at any point in their shopping journey. Placing payment buttons on the cart, product details page, or another page as a checkout shortcut can reduce steps to pay. For example:

- Buyers can select the button to check out from any page. Any items in their carts will show up at checkout.
- Buyers can skip manually adding contact details, shipping address, and payment details.
- Your shipping methods and rules are still used to complete the order.

This guide explains how to show the PayPal button upstream and during checkout. Follow these best practices to give customers the fewest steps to pay.



### Upstream presentment
Simplify the payment experience for new customers and reinforce PayPal as a payment option by placing the PayPal button as a checkout shortcut before the buyer manually enters any information, for example, on your cart page where the buyer reviews the items they selected.

Offering the PayPal button upstream simplifies the shopping experience for the buyer and the merchant:

- The buyer gets a streamlined, one-click purchase option.
- The merchant automatically receives the buyer's shipping, billing, and other payment information from the buyer's PayPal account. The buyer doesn't need to enter this information.

See the [Contact module](/docs/checkout/standard/customize/contact-module/) guide for more information.


**warning**
Per our User Agreement, you are required to follow certain standards when presenting PayPal or Venmo payment methods. You must treat PayPal and Venmo payment methods equally to other payment methods at your points of sale, including logo placement, payment flow, and fees. You need to show the PayPal and Venmo services prominently in the checkout experience, and don't present any other payment methods earlier in the checkout flow.


#### Best practices
Place checkout buttons on your cart and product details pages so buyers can start checkout whenever they're ready.

- Ensure that the PayPal button shows up earlier in the checkout experience, ahead of any other merchant-provided checkout flows that require data entry from the user.
- Place PayPal Pay Later messaging close to the order total so buyers can see it clearly as a financing option. See [Message placement](/docs/checkout/pay-later/us/integrate/message-placement/) for more information.
- Be sure to pass the data-page-type through the JavaScript SDK to indicate the type of page where you place the button. The data-page-type parameter helps PayPal optimize button behavior based on page types. See the [JavaScript SDK script configuration](/sdk/js/configuration/#link-datapagetype) page for more information.


![screenshot_one-time-payments_example-placement-01.png](https://paypalobjects.com/devdoc/best-practices/screenshot_one-time-payments_example-placement-01.png)

#### Optional placement
You can place the PayPal button upstream, such as on the product description page, to encourage quick, single-product checkouts.

- Ensure any modifiers for items show up ahead of the PayPal button.
- Pay Later messaging shows buyers that they can buy now and pay later if they check out with PayPal. Adding Pay Later messaging to your website can help improve conversion, attract new customers, and increase order values.


![screenshot_one-time-payments_example-placement-02.png](https://paypalobjects.com/devdoc/best-practices/screenshot_one-time-payments_example-placement-02.png)

**info**
**Note:** The callback may not be necessary when shipping fees don't change or aren't applicable.


**Enable shipping options callback**

Allow buyers to choose a delivery method during checkout. Use the shipping options callback to update the cart amount based on the selected shipping option.

If you don't integrate shipping options, PayPal can't display your delivery options. The buyer must return to the site to select delivery options before completing the transaction.

See the [Shipping module](/docs/checkout/standard/customize/shipping-module/) page for more details.


**info**
**Tip:** Use the shipping options callback for physical goods even when only one delivery method is available.


This callback applies to upstream flows where the buyer has not already selected a shipping method for their order, such as when the user clicks the PayPal button on the merchant cart page.


### Checkout presentment
If the buyer chooses to proceed manually through merchant checkout, have the user enter their shipping details, select their shipping method, and provide any other required details before presenting the PayPal button.


#### Best practices
We recommend the following best practices:

- Set up your checkout flow to identify PayPal users and proactively select the PayPal payment option to reduce decision fatigue for customers ready to complete their purchases.
- Clicking the PayPal button should be the buyer's last action in your checkout experience.
- After the buyer approves the transaction on the PayPal Checkout experience, redirect the buyer to the order success page.
- For transactions initiated from merchant checkout pages, pass the buyer's provided shipping address and contact information in the Create order call.
- Set the shipping preference in the Orders API to SET_PROVIDED_ADDRESS so the buyer can't change the shipping address during checkout. See the [Shipping module](/docs/checkout/standard/customize/shipping-module/) page for more information.


![screenshot_one-time-payments_example-checkout-page.png](https://paypalobjects.com/devdoc/best-practices/screenshot_one-time-payments_example-checkout-page.png)


## Implementing PayPal to deliver the highest conversion

### Optimize your buyer's PayPal login experience

#### Best practices
- If you have the buyer's email address, pass it in the Create order call. See the [Pass buyer identifier](/docs/checkout/standard/customize/pass-buyer-identifier) guide for more information.
- For merchants showing PayPal in web view, ensure the PayPal payment experience is always full height and never presented in an iframe.


![screenshot_one-time-payments_example-loading-page.png](https://paypalobjects.com/devdoc/best-practices/screenshot_one-time-payments_example-loading-page.png)

### Optimize your buyer's PayPal Checkout experience

#### Best practices
For all transactions:

- Include a [Pay Now](/docs/checkout/standard/customize/pay-now/) button on the PayPal review page so the buyer can complete the transaction in a checkout hosted by PayPal and then return to an order success or receipt page.
- Set up the PayPal review page to create the order when the buyer selects **Pay Now.** See the [Orders v2 API](/docs/api/orders/v2/) for more details.
- Ensure no more buyer action is needed after they complete payment through the PayPal review page.
- For transactions initiated from merchant checkout pages, pass the buyer's provided shipping address and contact information in the Create order call. See the [Pass buyer identifier](/docs/checkout/standard/customize/pass-buyer-identifier/) guidefor more information.
- For transactions initiated from upstream, such as cart and product pages, create the order with all supported shipping options when applicable. Integrate with shipping callbacks to calculate the shipping options, cost, and taxes based on the buyer's selected address. See the [Shipping module](/docs/checkout/standard/customize/shipping-module/) page for more details.
- Pass the invoice line item and SKU details through the [Create order](/docs/api/orders/v2/#orders_create) request. PayPal displays these details during checkout, which enhances buyer experience, provides greater transparency, increases conversion, and minimizes disputes as buyers can verify the specifics of their purchase. See the [Pass line-item details](/docs/checkout/standard/customize/pass-line-items/) page for more information.
- Implement [App Switch](https://developer.paypal.com/docs/checkout/standard/customize/app-switch/) to redirect buyers to the PayPalapp for streamlined authentication and checkout completion.


![screenshot_one-time-payments_example-paysheet.png](https://paypalobjects.com/devdoc/best-practices/screenshot_one-time-payments_example-paysheet.png)

#### Pay Now flow


![A,diagram,showing,the,Pay,Now,payment,flow.](https://paypalobjects.com/devdoc/best-practices/screenshot_one-time-payments_pay-now-flow.png)



## Next steps

### Message placement
Render effective messaging with message placement and product amount.


### Shipping Module
Present shipping details to a buyer during the PayPal flow.


### Contact Module
Help buyers add or modify contact information during checkout.


### Pass buyer identifier
Prefill a buyer's PayPal login page by passing their email address.


### Configure the data-page-type
Use theJavaScript SDK to configure the data-page-type .


### Create order
Create an order using the Orders v2 API.


### Pass line-item details
Manage line-item details using the Orders v2 API.


### App Switch
Streamline checkout by helping buyers finish transactions in the PayPal app.
