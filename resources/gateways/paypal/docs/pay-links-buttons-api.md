# Payment Links and Buttons API

Create and manage customizable payment resources using the Payment Links and Buttons API.
A payment link is a shareable URL that takes customers to a PayPal‑hosted payment page where they can complete purchases securely. Each payment link is unique to a product but can be shared and reused multiple times. Customers who open a payment link see a PayPal-hosted checkout page displaying product details such as name, price, description, variants, shipping fees, and taxes.

The Payment Links and Buttons API helps you:

* Accept payments through PayPal-hosted links.
* Offer multiple payment methods, including PayPal, Venmo, Pay Later, Apple Pay, and major credit and debit cards.
* See transactions happen in real time. PayPal sends email notifications to both buyers and merchants.
* Protect eligible online sales with [PayPal Seller Protection](https://www.paypal.com/us/webapps/mpp/security/seller-protection).

The following is a list of endpoints.

| Use case                                                                                                          | Endpoint                                     |
| :---------------------------------------------------------------------------------------------------------------- | :------------------------------------------- |
| [Create payment links and buttons](/payments/methods/pay-links-buttons-api#create-payment-links-and-buttons-post) | `POST /v1/checkout/payment-resources`        |
| [List payment links](/payments/methods/pay-links-buttons-api#list-payment-links-get)                              | `GET /v1/checkout/payment-resources`         |
| [Get payment link details](/payments/methods/pay-links-buttons-api#get-payment-link-details-get)                  | `GET /v1/checkout/payment-resources/{id}`    |
| [Update payment link](/payments/methods/pay-links-buttons-api#update-payment-link-put)                            | `PUT /v1/checkout/payment-resources/{id}`    |
| [Delete payment link](/payments/methods/pay-links-buttons-api#delete-payment-link-delete)                         | `DELETE /v1/checkout/payment-resources/{id}` |

## Eligibility

* This API is available in all countries where PayPal operates.
* See [Countries and Currencies](https://www.paypal.com/us/webapps/mpp/country-worldwide?_ga=2.213072083.673139926.1760916697-1259758161.1760473483) for a list of supported currencies.

## Prerequisites

* Set up a [PayPal Business Account](https://www.paypal.com/business/open-business-account?_ga=2.49411041.673139926.1760916697-1259758161.1760473483).
* Use the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) to obtain your client ID and secret, then integrate your backend using OAuth 2.0. See [Get started with PayPal REST APIs](https://developer.paypal.com/api/rest/?_ga=2.45348067.673139926.1760916697-1259758161.1760473483#link-getclientidandclientsecret) for more information.
* Navigate to the **Apps and Credentials** section on the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) to ensure the **Payment Links and Buttons** option is checked.

## How it works

The Payment Links and Buttons API helps merchants create and manage PayPal-hosted checkout experiences.

1. Obtain an OAuth access token using your PayPal Business account credentials.
2. Use the API to create payment links that define items, pricing, and return URLs.
3. Share the generated links directly or embed them on your website. The API doesn't currently support button code snippets, but you can create your own embeddable button using the link.
4. Buyers select the link to complete payment securely through PayPal's hosted checkout page. The payment is completed in real time.
5. Both merchants and buyers receive an email notification for each transaction. Merchants can view all transactions in their PayPal Business account. PayPal customers can view transaction details in their PayPal accounts.
6. You can retrieve, update, or delete existing payment links as needed.

```mermaid  theme={null}
graph LR
    Start([Start]) --> Auth[Get Access Token<br/>POST v1/oauth2/token]
    
    Auth --> Create[Create Resource<br/>POST v1/checkout/payment-resources]
    
    Create --> Active[Payment Resource<br/>Status: ACTIVE]
    
    Active --> Update[Update Resource<br/>PUT v1/checkout/payment-resources/id]
    
    Update --> Active
    
    Active --> Delete[Delete Resource<br/>DELETE v1/checkout/payment-resources/id]
    
    Delete --> Removed([Resource Removed])
    
    Active -.->|Query| List[List Resources<br/>GET v1/checkout/payment-resources]
    Active -.->|Query| Get[Get Details<br/>GET v1/checkout/payment-resources/id]
    
    List -.-> Active
    Get -.-> Active
    
    %% Styling
    classDef lifecycleStyle fill:#d1ecf1,stroke:#0c5460,stroke-width:3px,color:#000
    classDef stateStyle fill:#fff3cd,stroke:#856404,stroke-width:4px,color:#000
    classDef queryStyle fill:#e7d4f7,stroke:#6f42c1,stroke-width:2px,color:#000
    classDef authStyle fill:#cfe2ff,stroke:#084298,stroke-width:3px,color:#000
    classDef endStyle fill:#f8d7da,stroke:#dc3545,stroke-width:3px,color:#000
    
    class Create,Update,Delete lifecycleStyle
    class Active stateStyle
    class List,Get queryStyle
    class Auth authStyle
    class Removed endStyle
```

## Endpoints

The following table lists the available endpoints for managing payment links.

| Use case                 | Endpoint                                     | Request                                                                                                                   | Response                                                                                            |
| :----------------------- | :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------- |
| Create payment links     | `POST /v1/checkout/payment-resources`        | Include product details such as name, price, description, variants, taxes, shipping information, and return URL.          | Returns `201 Created` with the payment link ID, shareable link URL, status, and creation timestamp. |
| List payment links       | `GET /v1/checkout/payment-resources`         | No payload required. Use optional query parameters like `page_size` for results per page and `page_token` for pagination. | Returns `200 OK` with an array of payment links and pagination metadata.                            |
| Get payment link details | `GET /v1/checkout/payment-resources/{id}`    | Use the payment link ID in the URL path to retrieve details.                                                              | Returns `200 OK` with complete details for the specified payment link.                              |
| Update payment link      | `PUT /v1/checkout/payment-resources/{id}`    | Use the payment link ID in the URL path. Include the updated product information in the request body.                     | Returns `200 OK` with the updated payment link details.                                             |
| Delete payment link      | `DELETE /v1/checkout/payment-resources/{id}` | Use the payment link ID in the URL path to delete it permanently.                                                         | Returns `204 No Content` to confirm successful deletion.                                            |

## Product fields

Payment Links use product information and prices to showcase to buyers what your business is selling. To create a payment link, create a product with the following information.

| Field                      | Description                                                                                                                                                                                                                       |
| :------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name` (Required)          | Name of the product or service being sold.                                                                                                                                                                                        |
| `product_id`               | Unique identifier for the item, useful for merchant tracking and inventory management.                                                                                                                                            |
| `description`              | Text explaining the product or service for customer clarity.                                                                                                                                                                      |
| `unit_amount` (Required)   | Fixed amount set for the item.                                                                                                                                                                                                    |
| `taxes`                    | Tax amount applied to the product or service.                                                                                                                                                                                     |
| `shipping`                 | Shipping charge applied to the product or service.                                                                                                                                                                                |
| `collect_shipping_address` | Option to require customers to provide a shipping address at checkout.                                                                                                                                                            |
| `customer_notes`           | Text input field with a customizable label that captures customer information at checkout such as special instructions, delivery preferences. This field can be set as either optional or required.                               |
| `variants`                 | Product options such as size, color, or material with potential price differences. Supports up to 5 variants, each with up to 10 options. The first variant is classified as primary and can have prices assigned to each option. |
| `adjustable_quantity`      | The maximum number of units that can be purchased.                                                                                                                                                                                |
| `return_url`               | Redirects customers to a merchant-specified URL after payment completion.                                                                                                                                                         |

## Use cases

See how to create payment links that address common scenarios and requirements.

### Sample `POST` requests

The following are different sample use cases of the `POST` API that demonstrate how to create payment links for various scenarios.

### Create a payment link with a return URL

Create a payment link for a wireless mouse priced at \$39.99 USD. After completing payment, customers are redirected to the specified return URL, such as `https://merchant.example.com/thank-you`.

```bash [expandable] theme={null}
curl -v -k -X POST 'https://api.sandbox.paypal.com/v1/checkout/payment-resources' \
 -H 'Authorization: Bearer A21_A.AAfdJ1oilr2YCRMAosyU48X03YgHCyOPkH82XYdvJBQvRLnuha9ut2lYvN7QgDab-iTVDMDwR3OL-S1t4_GCrh62XdW18A' \
 -H 'Accept: application/json' \
 -H 'Content-Type: application/json' \
 -d '{
    "type": "BUY_NOW",
    "integration_mode": "LINK",
    "reusable": "MULTIPLE",
    "return_url": "https://merchant.example.com/thank-you",
    "line_items": [
        {
            "name": "Wireless Mouse",
            "unit_amount": {
                "currency_code": "USD",
                "value": "39.99"
            }
        }
    ]
}'
```

### Create a payment link with variants

Create a payment link for a T-shirt priced at \$20.00 USD. The `Color` dimension is marked as primary and includes two options: `White` and `Black`. The `Size` dimension is secondary and includes `11oz` and `15oz` options. The base price of \$20.00 applies to all variant combinations.

```bash [expandable] theme={null}
curl -v -k -X POST 'https://api.sandbox.paypal.com/v1/checkout/payment-resources' \
 -H 'Authorization: Bearer A21_A.AAfdJ1oilr2YCRMAosyU48X03YgHCyOPkH82XYdvJBQvRLnuha9ut2lYvN7QgDab-iTVDMDwR3OL-S1t4_GCrh62XdW18A' \
 -H 'Accept: application/json' \
 -H 'Content-Type: application/json' \
 -d '{
    "type": "BUY_NOW",
    "integration_mode": "LINK",
    "reusable": "MULTIPLE",
    "line_items": [
        {
            "name": "T-Shirt",
            "unit_amount": {
                "currency_code": "USD",
                "value": "20.00"
            },
            "variants": {
                "dimensions": [
                    {
                        "name": "Color",
                        "primary": true,
                        "options": [
                            {
                                "label": "White"
                            },
                            {
                                "label": "Black"
                            }
                        ]
                    },
                    {
                        "name": "Size",
                        "primary": false,
                        "options": [
                            {
                                "label": "11oz"
                            },
                            {
                                "label": "15oz"
                            }
                        ]
                    }
                ]
            }
        }
    ]
}'
```

### Create a payment link with variant-level pricing

Create a payment link for a T-shirt with variant-specific pricing. The `Color` dimension is marked as primary and includes two options: `White` priced at \$19.00 USD, and `Black` priced at \$20.00 USD. The `Size` dimension is secondary and includes `11oz` and `15oz` options, with no price difference. No base `unit_amount` shows up in the payload because each color variant specifies its own price.

```bash [expandable] theme={null}
curl -v -k -X POST 'https://api.sandbox.paypal.com/v1/checkout/payment-resources' \
 -H 'Authorization: Bearer A21_A.AAfdJ1oilr2YCRMAosyU48X03YgHCyOPkH82XYdvJBQvRLnuha9ut2lYvN7QgDab-iTVDMDwR3OL-S1t4_GCrh62XdW18A' \
 -H 'Accept: application/json' \
 -H 'Content-Type: application/json' \
 -d '{
    "integration_mode": "LINK",
    "type": "BUY_NOW",
    "reusable": "MULTIPLE",
    "line_items": [
        {
            "name": "T-Shirt",
            "variants": {
                "dimensions": [
                    {
                        "name": "Color",
                        "primary": true,
                        "options": [
                            {
                                "label": "White",
                                "unit_amount": {
                                    "currency_code": "USD",
                                    "value": "19.00"
                                }
                            },
                            {
                                "label": "Black",
                                "unit_amount": {
                                    "currency_code": "USD",
                                    "value": "20.00"
                                }
                            }
                        ]
                    },
                    {
                        "name": "Size",
                        "primary": false,
                        "options": [
                            {
                                "label": "11oz"
                            },
                            {
                                "label": "15oz"
                            }
                        ]
                    }
                ]
            }
        }
    ]
}'
```

### Create a payment link with taxes and shipping

Create a payment link for a coffee mug priced at \$12.00 USD with tax and shipping calculations. The `taxes` and `shipping` arrays specify `type: PREFERENCE` and `value: PROFILE` to apply the merchant's preconfigured tax and shipping settings from their PayPal account. Merchants must configure these tax and shipping settings in their PayPal account for this feature to work.

```bash [expandable] theme={null}
curl -v -k -X POST 'https://api.sandbox.paypal.com/v1/checkout/payment-resources' \
 -H 'Authorization: Bearer A21_A.AAfdJ1oilr2YCRMAosyU48X03YgHCyOPkH82XYdvJBQvRLnuha9ut2lYvN7QgDab-iTVDMDwR3OL-S1t4_GCrh62XdW18A' \
 -H 'Accept: application/json' \
 -H 'Content-Type: application/json' \
 -d '{
    "integration_mode": "LINK",
    "type": "BUY_NOW",
    "reusable": "MULTIPLE",
    "return_url": "https://merchant.example.com/thank-you",
    "line_items": [
        {
            "name": "Coffee Mug",
            "unit_amount": {
                "currency_code": "USD",
                "value": "12.00"
            },
            "taxes": [
                {
                    "name": "Sales Tax",
                    "type": "PREFERENCE",
                    "value": "PROFILE"
                }
            ],
            "shipping": [
                {
                    "type": "PREFERENCE",
                    "value": "PROFILE"
                }
            ]
        }
    ]
}'
```

## Create payment links and buttons (`POST`)

Create a buy now payment URL that links directly to a PayPal-hosted checkout experience. Use this endpoint to generate shareable payment URLs or various purchase flows.

Endpoint: `POST /v1/checkout/payment-resources`

### Request

The following sample request includes these key settings:

* Creates a reusable payment link for Premium Wireless Headphones with Noise Cancellation.
* Includes variant-specific pricing for four primary colors.
* Includes three variants where the color dimension is marked as primary and includes four options. The other two variants are `Warranty`, which has three options, and `Package Type`, which has two options. These variants do not affect pricing.
* Adds an 8.25% tax, applies a flat shipping rate, and requires customers to provide a shipping address.
* Provides customers with the option to add a gift message at checkout.
* Sets a maximum order quantity of 10 units.
* Redirects customers to a return URL after the transaction.

```json [expandable] theme={null}
{
  "integration_mode": "LINK",
  "type": "BUY_NOW",
  "reusable": "MULTIPLE",
  "return_url": "https://example-merchant.com/payment/return-success",
  "line_items": [
    {
      "name": "Premium Wireless Headphones with Noise Cancellation",
      "product_id": "PROD-WH-NC-2024-12345",
      "description": "Experience crystal-clear sound with our premium wireless headphones featuring active noise cancellation, 30-hour battery life",
      "taxes": [
        {
          "name": "State Sales Tax",
          "type": "PERCENTAGE",
          "value": "8.25"
        }
      ],
      "shipping": [
        {
          "type": "FLAT",
          "value": "12.50"
        }
      ],
      "collect_shipping_address": true,
      "customer_notes": [
        {
          "label": "Gift Message (Optional)",
          "required": false
        }
      ],
      "variants": {
        "dimensions": [
          {
            "name": "Color",
            "primary": true,
            "options": [
              {
                "label": "Midnight Black",
                "unit_amount": {
                  "currency_code": "USD",
                  "value": "149.99"
                }
              },
              {
                "label": "Silver Gray",
                "unit_amount": {
                  "currency_code": "USD",
                  "value": "149.99"
                }
              },
              {
                "label": "Rose Gold",
                "unit_amount": {
                  "currency_code": "USD",
                  "value": "169.99"
                }
              },
              {
                "label": "Navy Blue",
                "unit_amount": {
                  "currency_code": "USD",
                  "value": "159.99"
                }
              }
            ]
          },
          {
            "name": "Warranty",
            "primary": false,
            "options": [
              { "label": "Standard 1-Year" },
              { "label": "Extended 2-Year" },
              { "label": "Premium 3-Year" }
            ]
          },
          {
            "name": "Package Type",
            "primary": false,
            "options": [
              { "label": "Standard Box" },
              { "label": "Gift Wrapped" }
            ]
          }
        ]
      },
      "adjustable_quantity": {
        "maximum": 10
      }
    }
  ]
}
```

### Response

The following response contains a fixed-price payment resource link with product details and variants. The API returns HTTP status code `201 Created` and content type `application/json`.

```json [expandable] theme={null}
{
  "id": "PLB-8H2K9J3N5P7Q",
  "integration_mode": "LINK",
  "type": "BUY_NOW",
  "reusable": "MULTIPLE",
  "return_url": "https://example.com/return",
  "line_items": [
    {
      "name": "Premium Wireless Headphones",
      "product_id": "HEADPHONE-001",
      "description": "High-quality noise-canceling wireless headphones",
      "unit_amount": { "currency_code": "USD", "value": "199.99" },
      "taxes": [
        { "name": "Sales Tax", "amount": { "currency_code": "USD", "value": "16.00" } }
      ],
      "shipping": [
        { "name": "Standard Shipping", "amount": { "currency_code": "USD", "value": "5.99" } }
      ],
      "collect_shipping_address": true,
      "customer_notes": [{ "label": "Gift message", "required": false }],
      "variants": {
        "options": [
          { "name": "Color", "values": ["Black", "Silver", "White"] }
        ]
      },
      "adjustable_quantity": { "enabled": true, "min_quantity": 1, "max_quantity": 10 }
    }
  ],
  "status": "ACTIVE",
  "create_time": "2025-10-10T12:30:45Z",
  "payment_link": "https://www.paypal.com/paymentpage/PLB-8H2K9J3N5P7Q"
}
```

## List payment links (`GET`)

Retrieve a paginated list of all payment links created by the merchant. This endpoint supports filtering and pagination through query parameters, including filtering by link status and tags.

Endpoint: `GET /v1/checkout/payment-resources`

### Request

The following sample request includes these key details:

* Sends a `GET` request to list payment links you created.
* Uses the `page_size` parameter to limit results. For example, setting `page_size=2` returns two payment links per page.
* Includes an OAuth 2.0 Bearer token for authentication.
* Headers set to Accept: `application/json` and `Content-Type: application/json`.
* Uses a `page_token` from the response to retrieve additional pages.

```bash  theme={null}
curl -v -k -X GET 'https://api.sandbox.paypal.com/v1/checkout/payment-resources' \
  -H 'Authorization: Bearer A21_A.AAfdJ1oilr2YCRMAosyU48X03YgHCyOPkH82XYdvJBQvRLnuha9ut2lYvN7QgDab-iTVDMDwR3OL-S1t4_GCrh62XdW18A' \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json'
```

### Response

The following sample response includes these key details:

* Returns a resources array with two payment links.
* The first payment link is for a `Wireless Mouse`, priced at \$29.99 USD. This link is active, set to `BUY_NOW`, and is reusable.
* The second payment link is for a Wireless Keyboard, priced at \$99.99 USD. It has the same status, type, and reusability settings as the first link.
* Each resource includes a shareable `payment_link` URL, metadata such as ID, product name, price, status, type, and creation timestamp, and a links array with HATEOAS actions to retrieve, update, edit, delete, or access the payment link.
* The response also includes a top-level links array for navigation, with a self link referencing the current request and a next link with a `page_token` for retrieving additional results.

```json [expandable] theme={null}
{
  "resources": [
    {
      "id": "PLB-X7MNK9P2QR8T",
      "integration_mode": "LINK",
      "create_time": "2025-11-29T13:13:25.832592Z",
      "status": "ACTIVE",
      "payment_link": "https://www.paypal.com/ncp/payment/PLB-X7MNK9P2QR8T",
      "type": "BUY_NOW",
      "reusable": "MULTIPLE",
      "line_items": [
        {
          "name": "Wireless Mouse",
          "unit_amount": {
            "currency_code": "USD",
            "value": "29.99"
          }
        }
      ],
      "links": [
        {
          "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
          "rel": "self",
          "method": "GET"
        },
        {
          "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
          "rel": "replace",
          "method": "PUT"
        },
        {
          "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
          "rel": "edit",
          "method": "PATCH"
        },
        {
          "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
          "rel": "delete",
          "method": "DELETE"
        },
        {
          "href": "https://www.paypal.com/ncp/payment/PLB-X7MNK9P2QR8T",
          "rel": "payment_link",
          "method": "GET"
        }
      ]
    },
    {
      "id": "PLB-P2QR8TX7MNK9",
      "integration_mode": "LINK",
      "create_time": "2025-11-29T13:13:25.832592Z",
      "status": "ACTIVE",
      "payment_link": "https://www.paypal.com/ncp/payment/PLB-P2QR8TX7MNK9",
      "type": "BUY_NOW",
      "reusable": "MULTIPLE",
      "line_items": [
        {
          "name": "Wireless Keyboard",
          "unit_amount": {
            "currency_code": "USD",
            "value": "99.99"
          }
        }
      ],
      "links": [
        {
          "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-P2QR8TX7MNK9",
          "rel": "self",
          "method": "GET"
        },
        {
          "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-P2QR8TX7MNK9",
          "rel": "replace",
          "method": "PUT"
        },
        {
          "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-P2QR8TX7MNK9",
          "rel": "edit",
          "method": "PATCH"
        },
        {
          "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-P2QR8TX7MNK9",
          "rel": "delete",
          "method": "DELETE"
        },
        {
          "href": "https://www.paypal.com/ncp/payment/PLB-P2QR8TX7MNK9",
          "rel": "payment_link",
          "method": "GET"
        }
      ]
    }
  ],
  "links": [
    {
      "href": "https://api.paypal.com/v1/checkout/payment-resources?page_size=2",
      "rel": "self"
    },
    {
      "href": "https://api.paypal.com/v1/checkout/payment-resources?page_token=eyJleGNsdXNpdmVfc3RhcnRfa2V5Ijp7ImlkIjoiUExCLVAyUVI4VFg3TU5LOSJ9LCJwYWdlX3NpemUiOjJ9",
      "rel": "next"
    }
  ]
}
```

## Get payment link details (`GET`)

Get the details of a specific payment link by its unique ID. This endpoint returns all available metadata, including payment status, links, reusable type, and line item details for the requested payment link.

Endpoint: `GET /v1/checkout/payment-resources/{id}`

### Request

The following sample request includes these key details:

* Includes the complete details for a specific payment link identified by the resource ID `PLB-X7MNK9P2QR8T` using a `GET` request.
* Uses an OAuth 2.0 Bearer token in the Authorization header to authenticate the request.
* Sets the `Accept` and `Content-Type` headers to `application/json` for proper formatting.

```bash  theme={null}
curl -v -k -X GET 'https://api.sandbox.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T' \
 -H 'Authorization: Bearer A21_A.AAfdJ1oilr2YCRMAosyU48X03YgHCyOPkH82XYdvJBQvRLnuha9ut2lYvN7QgDab-iTVDMDwR3OL-S1t4_GCrh62XdW18A' \
 -H 'Accept: application/json' \
 -H 'Content-Type: application/json'
```

### Response

The following response contains the complete details for a single fixed-price payment link. The API returns status code `200 OK` and content type `application/json`.

The following sample response includes these key details:

* Returns the full details of payment link `PLB-X7MNK9P2QR8T`.
* The payment link is active, set to `BUY_NOW`, and configured for multiple uses.
* Shows a product called Wireless Mouse, priced at \$29.99 USD
* The link was created on `2025-11-29T13:13:25.832592Z` with integration mode `LINK`.
* After payment, customers are redirected to `https://merchant.example.com/thank-you` that is specified by return\_url.
* Includes a shareable payment link URL at `https://www.paypal.com/ncp/payment/PLB-X7MNK9P2QR8T`.
* Provides a links array with HATEOAS actions: retrieve the link details (`self`), update the link (`replace`), delete the link (`delete`), and access the customer-facing payment page (`payment_link`).

```json [expandable] theme={null}
{
  "id": "PLB-X7MNK9P2QR8T",
  "integration_mode": "LINK",
  "create_time": "2025-11-29T13:13:25.832592Z",
  "status": "ACTIVE",
  "payment_link": "https://www.paypal.com/ncp/payment/PLB-X7MNK9P2QR8T",
  "type": "BUY_NOW",
  "reusable": "MULTIPLE",
  "return_url": "https://merchant.example.com/thank-you",
  "line_items": [
    {
      "name": "Wireless Mouse",
      "unit_amount": {
        "currency_code": "USD",
        "value": "29.99"
      }
    }
  ],
  "links": [
    {
      "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
      "rel": "self",
      "method": "GET"
    },
    {
      "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
      "rel": "replace",
      "method": "PUT"
    },
    {
      "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
      "rel": "delete",
      "method": "DELETE"
    },
    {
      "href": "https://www.paypal.com/ncp/payment/PLB-X7MNK9P2QR8T",
      "rel": "payment_link",
      "method": "GET"
    }
  ]
}
```

## Update payment link (`PUT`)

Update a specific payment link by its unique identifier. This endpoint helps you replace the product and checkout details for a fixed price payment link with new configuration data.

Endpoint: `PUT /v1/checkout/payment-resources/{id}`

### Request

The following sample request includes these key details:

* Sends a `PUT` request to update the payment link with ID `PLB-X7MNK9P2QR8T`.
* Uses an OAuth 2.0 Bearer token in the Authorization header for authentication.
* Includes the `Accept` and `Content-Type` headers set to `application/json`.
* Sends the updated link configuration in the request body, replacing the existing product information entirely.
* Maintains the same payment link ID and URL while applying the new settings.

> **Note:** The API currently only uses `PUT` calls instead of `PATCH` calls.

```bash  theme={null}
curl -v -k -X PUT 'https://api.sandbox.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T' \
 -H 'Authorization: Bearer A21_A.AAfdJ1oilr2YCRMAosyU48X03YgHCyOPkH82XYdvJBQvRLnuha9ut2lYvN7QgDab-iTVDMDwR3OL-S1t4_GCrh62XdW18A' \
 -H 'Accept: application/json' \
 -H 'Content-Type: application/json' \
 -d '{
    "type": "BUY_NOW",
    "integration_mode": "LINK",
    "reusable": "MULTIPLE",
    "return_url": "https://merchant.example.com/thank-you",
    "line_items": [
        {
            "name": "Wireless Mouse",
            "unit_amount": {
                "currency_code": "USD",
                "value": "29.99"
            }
        }
    ]
}'
```

### Response

The following response contains the confirmation details of an updated payment link.

The API returns HTTP status `204 No Content` or, in some cases,  a confirmation response body with the content type `application/json`.

The following sample response includes these key details:

* Confirms that the updated payment link `PLB-X7MNK9P2QR8T` has been successfully applied.
* Returns the payment link with `ACTIVE` status, maintaining the same ID and payment link URL.
* Preserves the original creation time.
* May include a response body with updated configuration details, depending on implementation.

```json [expandable] theme={null}
{
  "id": "PLB-X7MNK9P2QR8T",
  "integration_mode": "LINK",
  "create_time": "2025-11-29T13:13:25.832592Z",
  "status": "ACTIVE",
  "payment_link": "https://www.paypal.com/ncp/payment/PLB-X7MNK9P2QR8T",
  "type": "BUY_NOW",
  "reusable": "MULTIPLE",
  "return_url": "https://merchant.example.com/thank-you",
  "line_items": [
    {
      "name": "Wireless Mouse",
      "unit_amount": {
        "currency_code": "USD",
        "value": "29.99"
      }
    }
  ],
  "links": [
    {
      "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
      "rel": "self",
      "method": "GET"
    },
    {
      "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
      "rel": "replace",
      "method": "PUT"
    },
    {
      "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
      "rel": "delete",
      "method": "DELETE"
    },
    {
      "href": "https://api.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T",
      "rel": "edit",
      "method": "PATCH"
    },
    {
      "href": "https://www.paypal.com/ncp/payment/PLB-X7MNK9P2QR8T",
      "rel": "payment_link",
      "method": "GET"
    }
  ]
}
```

## Delete payment link (`DELETE`)

Delete a specific payment link by its unique identifier. This endpoint permanently removes a payment link or button associated with the specified ID.

Endpoint: `DELETE /v1/checkout/payment-resources/{id}`

### Request

The following sample request includes these key details:

* Sends a `DELETE` request to permanently remove the payment link with ID `PLB-X7MNK9P2QR8T`.
* Uses an OAuth 2.0 Bearer token in the Authorization header for authentication.
* Includes the Accept and Content-Type headers set to `application/json`.

```bash  theme={null}
curl -v -k -X DELETE 'https://api.sandbox.paypal.com/v1/checkout/payment-resources/PLB-X7MNK9P2QR8T' \
 -H 'Authorization: Bearer A21_A.AAfdJ1oilr2YCRMAosyU48X03YgHCyOPkH82XYdvJBQvRLnuha9ut2lYvN7QgDab-iTVDMDwR3OL-S1t4_GCrh62XdW18A' \
 -H 'Accept: application/json' \
 -H 'Content-Type: application/json'
```

### Response

The API returns HTTP status `204 No Content` with the content type `application/json`, indicating that the payment link was deleted. No response body is returned.

## Error handling

| HTTP code | Error name              | Error message                                                                                          | Common cause                                                                                                                                                                                                                                   |
| :-------- | :---------------------- | :----------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`     | `INVALID_REQUEST`       | Request is not well-formed, syntactically incorrect, or violates the schema.                           | Missing required payment resource fields such as item name, amount, and return URL in the body.                                                                                                                                                |
| `403`     | `NOT_AUTHORIZED`        | Authorization failed due to insufficient permissions.                                                  | The access token is expired or lacks the correct OAuth scopes, and the merchant account doesn't have permission for payment buttons. Check the **Apps and Credentials** section to ensure the **Payment Links and Buttons** option is checked. |
| `404`     | `RESOURCE_NOT_FOUND`    | The specified resource does not exist.                                                                 | The payment resource ID is wrong, expired, or deleted. You may have tried to fetch, update, or delete a link or button that no longer exists.​                                                                                                 |
| `422`     | `UNPROCESSABLE_ENTITY`  | The requested action could not be performed, is semantically incorrect, or failed business validation. | Invalid payment amount, unsupported currency, or business rule violation, such as a duplicate payment link.                                                                                                                                    |
| `500`     | `INTERNAL_SERVER_ERROR` | An internal server error has occurred.                                                                 | Temporary disruption during payment link or button processing. Retry the request or contact support if the issue persists.                                                                                                                     |

For more information, see [Common errors overview](https://docs.paypal.ai/developer/how-to/api/troubleshooting/common-errors/overview).

## Test

* Create a [sandbox account](https://developer.paypal.com/tools/sandbox/) through the PayPal Developer Portal.
* Use your sandbox environment for all development and testing.
* All endpoints are duplicated for the sandbox (`api-m.sandbox.paypal.com`) and live environments​.
* Test your live payment link by making a purchase. Then verify the transaction in the **Activity** section of your PayPal account. Be sure to refund the test transaction afterward.


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.paypal.ai/llms.txt