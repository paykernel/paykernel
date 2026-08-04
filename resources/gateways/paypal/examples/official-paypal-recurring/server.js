import express from "express";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
    ApiError,
    Client,
    Environment,
    LogLevel,
    OrdersController,
    VaultController,
} from "@paypal/paypal-server-sdk";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const {
    PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET,
    PORT = 8080,
} = process.env;

const client = new Client({
    clientCredentialsAuthCredentials: {
        oAuthClientId: PAYPAL_CLIENT_ID,
        oAuthClientSecret: PAYPAL_CLIENT_SECRET,
    },
    timeout: 0,
    environment: Environment.Sandbox,
    logging: {
        logLevel: LogLevel.Info,
        logRequest: { logBody: true },
        logResponse: { logHeaders: true },
    },
});

const ordersController = new OrdersController(client);
const vaultController = new VaultController(client);

/**
 * Create a setup token from the given payment source and adds it to the Vault of the associated customer.
 * @see https://developer.paypal.com/docs/api/payment-tokens/v3/#setup-tokens_create
 */
const createVaultSetupToken = async () => {
    const collect = {
        /* Unique identifier for your request to maintain idempotency */
        paypalRequestId: randomUUID(),
        body: {
            paymentSource: {
                paypal: {
                    usageType: "MERCHANT",
                    usagePattern: "SUBSCRIPTION_PREPAID",
                    billingPlan: {
                        billingCycles: [
                            {
                                tenureType: "REGULAR",
                                pricingScheme: {
                                    pricingModel: "FIXED",
                                    price: {
                                        value: "100",
                                        currencyCode: "USD",
                                    },
                                },
                                frequency: {
                                    intervalUnit: "MONTH",
                                    intervalCount: "1",
                                },
                                totalCycles: "1",
                                startDate: "2026-01-10",
                            },
                        ],
                        oneTimeCharges: {
                            productPrice: {
                                value: "10",
                                currencyCode: "USD",
                            },
                            totalAmount: {
                                value: "10",
                                currencyCode: "USD",
                            },
                        },
                        product: {
                            description: "Yearly Membership",
                            quantity: "1",
                        },
                        name: "Company",
                    },
                    experienceContext: {
                        returnUrl: "https://example.com/returnUrl",
                        cancelUrl: "https://example.com/cancelUrl",
                    },
                },
            },
        },
    };

    try {
        const { result, ...httpResponse } =
            await vaultController.setupTokensCreate(collect);
        // Get more response info...
        // const { statusCode, headers } = httpResponse;
        return {
            jsonResponse: result,
            httpStatusCode: httpResponse.statusCode,
        };
    } catch (error) {
        if (error instanceof ApiError) {
            // const { statusCode, headers } = error;
            throw new Error(error.message);
        }
    }
};

// setupTokensCreate route
app.post("/api/vault", async (req, res) => {
    try {
        const { jsonResponse, httpStatusCode } = await createVaultSetupToken();
        res.status(httpStatusCode).json(jsonResponse);
    } catch (error) {
        console.error("Failed to set up vault token:", error);
        res.status(500).json({ error: "Failed to set up vault token." });
    }
});


/**
 * Creates a Payment Token from the given payment source and adds it to the Vault of the associated customer.
 * @see https://developer.paypal.com/docs/api/payment-tokens/v3/#payment-tokens_create
 */
const createPaymentToken = async () => {
        const collect = {
            /* Unique identifier for your request to maintain idempotency */
            paypalRequestId: randomUUID(),
        body: {
            paymentSource: {},
        },
    };
        try {
            const { result, ...httpResponse } =
                await vaultController.paymentTokensCreate(collect);
            // Get more response info...
            // const { statusCode, headers } = httpResponse;
            return {
                jsonResponse: result,
                httpStatusCode: httpResponse.statusCode,
            };
    } catch (error) {
        if (error instanceof ApiError) {
            // const { statusCode, headers } = error;
            throw new Error(error.message);
        }
    }
};

// paymentTokensCreate route
app.post("/api/vault/payment-tokens", async (req, res) => {
    try {
        const { jsonResponse, httpStatusCode } = await createPaymentToken();
        res.status(httpStatusCode).json(jsonResponse);
    } catch (error) {
        console.error("Failed to create payment token:", error);
        res.status(500).json({ error: "Failed to create payment token." });
    }
});

/**
 * Create an order utilizing the payment token.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_create
 */
const createOrder = async (cart) => {
    const collect = {
        body: {
            intent: "CAPTURE",
            purchaseUnits: [
                {
                    amount: {
                        currencyCode: "USD",
                        value: "100",
                    },
                },
            ],
            paymentSource: {
                paypal: {
                    vaultId: "PAYMENT-TOKEN-ID",
                    storedCredential: {
                        paymentInitiator: "MERCHANT",
                        usage: "SUBSEQUENT",
                        usagePattern: "RECURRING_POSTPAID",
                    },
                },
            },
        },
        prefer: "return=minimal",
    };


    try {
        const { body, ...httpResponse } = await ordersController.ordersCreate(
            collect
        );
        // Get more response info...
        // const { statusCode, headers } = httpResponse;
        return {
            jsonResponse: JSON.parse(body),
            httpStatusCode: httpResponse.statusCode,
        };
    } catch (error) {
        if (error instanceof ApiError) {
            // const { statusCode, headers } = error;
            throw new Error(error.message);
        }
    }
};

// createOrder route
app.post("/api/orders", async (req, res) => {
    try {
        // use the cart information passed from the front-end to calculate the order amount detals
        const { cart } = req.body;
        const { jsonResponse, httpStatusCode } = await createOrder(cart);
        res.status(httpStatusCode).json(jsonResponse);
    } catch (error) {
        console.error("Failed to create order:", error);
        res.status(500).json({ error: "Failed to create order." });
    }
});

app.listen(PORT, () => {
    console.log(`Node server listening at http://localhost:${PORT}/`);
});
