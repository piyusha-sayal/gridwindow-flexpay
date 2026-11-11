# PayPal Sandbox webhook receiver (/api/openapi/webhooks/paypalWebhook)

`POST /api/webhooks/paypal`

Verifies the PayPal signature against the unaltered body, then re-reads provider state. A webhook alone never marks a payment captured or voided.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/webhooks/paypal:
    post:
      tags:
        - Webhooks
      operationId: paypalWebhook
      summary: PayPal Sandbox webhook receiver
      description: Verifies the PayPal signature against the unaltered body, then
        re-reads provider state. A webhook alone never marks a payment captured
        or voided.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
      responses:
        "200":
          description: Accepted
        "400":
          description: Signature verification failed
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  client.webhooks.paypal_webhook({})
              except ApiError as e:
                  # TODO: Handle 'e.error' of type PaypalWebhookErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                await client.webhooks.paypalWebhook({ body: {} });
              } catch (err) {
                // TODO: Handle 'err' of type Webhooks.PaypalWebhookError, discriminated with 'err.payload.kind'
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