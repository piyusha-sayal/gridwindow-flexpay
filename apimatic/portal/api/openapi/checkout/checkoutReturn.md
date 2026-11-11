# PayPal return URL. Authorizes the approved order, then redirects to the reservation (/api/openapi/checkout/checkoutReturn)

`GET /api/checkout/return`

PayPal return URL. Authorizes the approved order, then redirects to the reservation.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/checkout/return:
    get:
      tags:
        - Checkout
      operationId: checkoutReturn
      summary: PayPal return URL. Authorizes the approved order, then redirects to the
        reservation
      parameters:
        - name: rid
          in: query
          required: true
          schema:
            type: string
        - name: state
          in: query
          required: true
          schema:
            type: string
          description: Signed anti-forgery state
        - name: token
          in: query
          required: true
          schema:
            type: string
          description: PayPal order id
      responses:
        "303":
          description: Redirect to the reservation page
      description: PayPal return URL. Authorizes the approved order, then redirects to
        the reservation.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  client.checkout.checkout_return(
                      "some example string",
                      "some example string",
                      "some example string",
                  )
              except ApiError as e:
                  ...  # TODO: Handle 'e.error' of type RawError
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                await client.checkout.checkoutReturn({
                  rid: "some example string",
                  state: "some example string",
                  token: "some example string",
                });
              } catch (err) {
                // TODO: Handle 'err' of type Checkout.CheckoutReturnError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
info:
  title: GridWindow FlexPay API
  version: 1.0.0
```