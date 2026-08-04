// import {Client, Environment, OrdersController} from "@paypal/paypal-server-sdk";
// import {GlobalError} from "@/lib/errors";
// import {db} from "@/lib/db";
// import {PaymentService} from "@/modules/payments/payments.service";
//
// export abstract class PaypalService {
//     static async createPaypalClient(field: { value: Record<string, any> } | null) {
//         if (!field || !field.value || !(field.value as any)["paypal"]) {
//             throw new Error("PayPal configuration not found in field data.");
//         }
//
//         const paypalConfig = (field.value as any)["paypal"];
//         const environment = paypalConfig.isSandbox
//             ? Environment.Sandbox
//             : Environment.Production;
//
//         return new Client({
//             clientCredentialsAuthCredentials: {
//                 oAuthClientId: paypalConfig.clientId,
//                 oAuthClientSecret: paypalConfig.secretId,
//             },
//             timeout: 0,
//             environment: environment,
//         });
//     }
//
//     static async createOrder(transactionId: string, successUrl: string, cancelUrl: string, amount: string, tx?: any) {
//         let field = !tx ? await db.field.findUnique({
//             where: {key: "payments"},
//             select: {
//                 value: true,
//             },
//         }) : tx as any;
//         if (!field || !field.value || !(field.value as any)["paypal"]) {
//             throw new GlobalError("Payment configuration not found.", 500);
//         }
//
//         const paypalClient = await this.createPaypalClient(field);
//         const {currency} = field.value || {currency: 'usd'};
//
//         const ordersController = new OrdersController(paypalClient);
//
//         try {
//             const {statusCode, body} = await ordersController.createOrder({
//                 body: {
//                     intent: 'CAPTURE' as any,
//                     purchaseUnits: [{
//                         amount: {
//                             currencyCode: currency.toUpperCase() || 'USD',
//                             value: amount.toString()
//                         },
//                         description: `Transaction ${transactionId}`,
//                         referenceId: transactionId
//                     }],
//                     paymentSource: {
//                         paypal: {
//                             experienceContext: {
//                                 returnUrl: successUrl,
//                                 cancelUrl,
//                                 locale: "ar-SA",
//                                 landingPage: "BILLING" as any,
//                                 shippingPreference: "NO_SHIPPING" as any, // No shipping for digital goods
//                                 userAction: "PAY_NOW" as any // Show "Pay Now" button
//                             }
//                         }
//                     }
//                 }
//             });
//
//             if (statusCode !== 201) {
//                 throw new GlobalError("Failed to create PayPal order. Please try again later.", 500);
//             }
//
//             const result = JSON.parse(body as any);
//
//             if (!result || !result.id) {
//                 throw new GlobalError("Invalid response from PayPal. Please try again later.", 500);
//             }
//
//             // Find the approval URL
//             const approvalUrl = result.links?.find((link: any) => link.rel === 'approve')?.href;
//
//             return {
//                 orderId: result.id,
//                 status: result.status,
//                 approvalUrl
//             };
//         } catch (error) {
//             console.error('Error creating PayPal order:', error);
//             throw new GlobalError("Failed to create PayPal order. Please try again later.", 500);
//         }
//     }
//
//     static async getOrderDetails(orderID: string) {
//         const field = await db.field.findUnique({
//             where: {key: "payments"},
//             select: {
//                 value: true,
//             },
//         });
//         if (!field || !field.value || !(field.value as any)["paypal"]) {
//             throw new GlobalError("Payment configuration not found.", 500);
//         }
//
//         const paypalClient = await this.createPaypalClient(field as any);
//         const ordersController = new OrdersController(paypalClient);
//
//         try {
//             const {body, statusCode} = await ordersController.getOrder({
//                 id: orderID,
//             });
//
//             if (statusCode !== 200) {
//                 throw new GlobalError("Failed to get PayPal order details.", 500);
//             }
//
//             const result = JSON.parse(body as any);
//
//             const approvalUrl = result.links?.find((link: any) => link.rel === 'approve')?.href;
//
//             return {
//                 orderId: result.id,
//                 status: result.status,
//                 approvalUrl,
//                 details: result
//             };
//         } catch (error) {
//             console.error('Error getting PayPal order details:', error);
//             throw new GlobalError("Failed to get PayPal order details.", 500);
//         }
//     }
//
//     static async captureOrder(orderID: string) {
//         const field = await db.field.findUnique({
//             where: {key: "payments"},
//             select: {
//                 value: true,
//             },
//         });
//         if (!field || !field.value || !(field.value as any)["paypal"]) {
//             throw new GlobalError("Payment configuration not found.", 500);
//         }
//
//         const paypalClient = await this.createPaypalClient(field as any);
//         const ordersController = new OrdersController(paypalClient);
//
//         try {
//             // First check the order status
//             const orderDetails = await this.getOrderDetails(orderID);
//
//             if (orderDetails.status !== 'APPROVED') {
//                 throw new Error(
//                     `Cannot capture order. Order status is ${orderDetails.status}. The order must be approved by the payer first. ${orderDetails.approvalUrl ? `Please redirect the user to: ${orderDetails.approvalUrl}` : 'No approval URL available.'}`);
//             }
//
//             const {body, statusCode} = await ordersController.captureOrder({
//                 id: orderID,
//             });
//
//             const result = JSON.parse(body as any);
//
//             if (statusCode !== 201) {
//                 throw new Error("Failed to capture PayPal order. Please try again later.");
//             }
//
//             // IMPORTANT: Validate the payment was actually successful
//             if (result.status !== 'COMPLETED') {
//                 throw new Error(`Payment not completed. Status: ${result.status}`);
//             }
//
//             // Validate that we have purchase units with successful payments
//             if (!result.purchase_units || result.purchase_units.length === 0) {
//                 throw new Error("No purchase units found in PayPal response.");
//             }
//
//             const purchaseUnit = result.purchase_units[0];
//             if (!purchaseUnit.payments || !purchaseUnit.payments.captures || purchaseUnit.payments.captures.length === 0) {
//                 throw new Error("No successful captures found in PayPal response.");
//             }
//
//             // Check each capture to ensure it's completed
//             const failedCaptures = purchaseUnit.payments.captures.filter(
//                 (capture: any) => capture.status !== 'COMPLETED'
//             );
//
//             if (failedCaptures.length > 0) {
//                 console.error('Failed captures found:', failedCaptures);
//                 throw new Error(`Payment capture failed. Capture status: ${failedCaptures[0].status}. Reason: ${failedCaptures[0].status_details?.reason || 'Unknown'}`);
//             }
//
//             // Additional validation: Check if payment amount matches expected amount
//             const capturedAmount = purchaseUnit.payments.captures[0].amount;
//             if (!capturedAmount || !capturedAmount.value) {
//                 throw new Error("Invalid captured amount in PayPal response.");
//             }
//
//             // Only call webhook handler after all validations pass
//             await PaymentService.webhookHandler(result.purchase_units[0].reference_id, "success");
//
//             return {
//                 orderId: result.id,
//                 status: result.status,
//                 capturedAmount: capturedAmount.value,
//                 currency: capturedAmount.currency_code
//             };
//         } catch (error) {
//             console.error('Error capturing PayPal order:', error);
//
//             // Handle specific PayPal API errors
//             if (error instanceof Error && (error as any).result) {
//                 const apiError = (error as any).result;
//
//                 // Handle compliance violation
//                 if (apiError.name === 'UNPROCESSABLE_ENTITY') {
//                     const complianceViolation = apiError.details?.find((detail: any) =>
//                         detail.issue === 'COMPLIANCE_VIOLATION'
//                     );
//
//                     if (complianceViolation) {
//                         console.error('PayPal Compliance Violation:', apiError);
//                         throw new GlobalError(
//                             "Transaction blocked due to PayPal compliance policies. This often happens in sandbox with repeated test transactions. Please try with a different test account or contact support.",
//                             422
//                         );
//                     }
//
//                     const orderNotApproved = apiError.details?.find((detail: any) =>
//                         detail.issue === 'ORDER_NOT_APPROVED'
//                     );
//
//                     if (orderNotApproved) {
//                         // Get order details to provide the approval URL
//                         try {
//                             const orderDetails = await this.getOrderDetails(orderID);
//                             throw new GlobalError(
//                                 `Order not approved by payer. Please redirect the user to approve the payment: ${orderDetails.approvalUrl || 'Approval URL not available'}`,
//                                 422
//                             );
//                         } catch (detailError) {
//                             throw new GlobalError("Order not approved by payer. Please redirect the user to PayPal to approve the payment.", 422);
//                         }
//                     }
//
//                     // Handle invalid card details
//                     const invalidCardDetails = apiError.details?.find((detail: any) =>
//                         detail.issue === 'INSTRUMENT_DECLINED' ||
//                         detail.issue === 'CARD_EXPIRED' ||
//                         detail.issue === 'INVALID_CARD_NUMBER' ||
//                         detail.issue === 'INVALID_CARD_SECURITY_CODE'
//                     );
//
//                     if (invalidCardDetails) {
//                         throw new GlobalError(
//                             "Card payment failed: " + (invalidCardDetails.description || "Invalid card details provided."),
//                             422
//                         );
//                     }
//                 }
//             }
//
//             throw new GlobalError("Failed to capture PayPal order. Please try again later.", 500);
//         }
//     }
// }
