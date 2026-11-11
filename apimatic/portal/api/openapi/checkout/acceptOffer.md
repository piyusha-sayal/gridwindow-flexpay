# Accept one exact, unexpired offer and create the PayPal authorize order (/api/openapi/checkout/acceptOffer)

`POST /api/offers/accept`

Requires the driver's explicit consent (`consent: true`) and the `termsHash` the driver saw; tampered or expired
terms are refused. Returns the PayPal approval link. Nothing is authorized or charged until the buyer approves in PayPal.


```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/offers/accept:
    post:
      tags:
        - Checkout
      operationId: acceptOffer
      summary: Accept one exact, unexpired offer and create the PayPal authorize order
      description: >
        Requires the driver's explicit consent (`consent: true`) and the
        `termsHash` the driver saw; tampered or expired

        terms are refused. Returns the PayPal approval link. Nothing is
        authorized or charged until the buyer approves in PayPal.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required:
                - quoteSetId
                - offerId
                - termsHash
                - consent
              properties:
                quoteSetId:
                  type: string
                  maxLength: 64
                offerId:
                  type: string
                  maxLength: 128
                termsHash:
                  type: string
                  pattern: ^[0-9a-f]{64}$
                consent:
                  type: boolean
                  const: true
      responses:
        "200":
          description: Reservation created, waiting for buyer approval
          content:
            application/json:
              schema:
                type: object
                required:
                  - reservationId
                  - approveUrl
                  - providerMode
                properties:
                  reservationId:
                    type: string
                  approveUrl:
                    type: string
                    description: PayPal Sandbox checkout URL, or the in-app MOCK approval page
                  providerMode:
                    $ref: "#/components/schemas/ProviderMode"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          $ref: "#/components/responses/Conflict"
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.checkout.accept_offer(
                      ApiOffersAcceptRequest(
                          quote_set_id="some example string",
                          offer_id="some example string",
                          terms_hash="some example string",
                      ),
                  )
                  # TODO: Handle 'response' of type
                  # ApiOffersAcceptResponse
              except ApiError as e:
                  # TODO: Handle 'e.error' of type AcceptOfferErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.checkout.acceptOffer({
                  body: {
                    quoteSetId: "some example string",
                    offerId: "some example string",
                    termsHash: "some example string",
                  },
                });
                // TODO: Handle 'response' of type ApiOffersAcceptResponse
              } catch (err) {
                // TODO: Handle 'err' of type Checkout.AcceptOfferError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
  schemas:
    ProviderMode:
      type: string
      enum:
        - PAYPAL_SANDBOX
        - MOCK
    Error:
      type: object
      required:
        - error
      properties:
        error:
          type: object
          required:
            - code
            - message
          properties:
            code:
              type: string
              examples:
                - QUOTE_EXPIRED
                - TERMS_MISMATCH
                - VALIDATION_ERROR
                - BAD_ORIGIN
            message:
              type: string
            fields:
              type: array
              items:
                type: string
  responses:
    NotFound:
      description: Not found (or not the caller's)
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
    Conflict:
      description: The request conflicts with current state (expired offer, terms
        mismatch, already accepted, ...)
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
info:
  title: GridWindow FlexPay API
  version: 1.0.0
```