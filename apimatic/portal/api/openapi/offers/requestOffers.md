# Request priced charging offers for one port and night (/api/openapi/offers/requestOffers)

`POST /api/quotes`

Creates the driver session cookie if absent. Each offer carries exact terms and their SHA-256 `termsHash`, which accept must echo.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/quotes:
    post:
      tags:
        - Offers
      operationId: requestOffers
      summary: Request priced charging offers for one port and night
      description: Creates the driver session cookie if absent. Each offer carries
        exact terms and their SHA-256 `termsHash`, which accept must echo.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/QuoteRequest"
      responses:
        "200":
          description: The quote set
          content:
            application/json:
              schema:
                type: object
                required:
                  - quote
                properties:
                  quote:
                    $ref: "#/components/schemas/QuoteSet"
        "400":
          $ref: "#/components/responses/ValidationError"
        "403":
          $ref: "#/components/responses/BadOrigin"
        "409":
          $ref: "#/components/responses/Conflict"
        "429":
          $ref: "#/components/responses/RateLimited"
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.offers.request_offers(
                      QuoteRequest(
                          port_id="some example string",
                          night_of="some example string",
                          plug_in_local="some example string",
                          depart_local="some example string",
                          target_battery_k_wh=1.5,
                          spend_cap_cents=1,
                      ),
                  )
                  # TODO: Handle 'response' of type ApiQuotesResponse
              except ApiError as e:
                  # TODO: Handle 'e.error' of type RequestOffersErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.offers.requestOffers({
                  body: {
                    portId: "some example string",
                    nightOf: "some example string",
                    plugInLocal: "some example string",
                    departLocal: "some example string",
                    targetBatteryKWh: 1.5,
                    spendCapCents: 1,
                  },
                });
                // TODO: Handle 'response' of type ApiQuotesResponse
              } catch (err) {
                // TODO: Handle 'err' of type Offers.RequestOffersError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
  schemas:
    QuoteRequest:
      type: object
      additionalProperties: false
      required:
        - portId
        - nightOf
        - plugInLocal
        - departLocal
        - targetBatteryKWh
        - spendCapCents
      properties:
        portId:
          type: string
          maxLength: 32
        nightOf:
          type: string
          pattern: ^\d{4}-\d{2}-\d{2}$
        plugInLocal:
          type: string
          pattern: ^\d{2}:\d{2}$
          description: Station-local time
        departLocal:
          type: string
          pattern: ^\d{2}:\d{2}$
          description: Station-local ready-by time (next morning)
        targetBatteryKWh:
          type: number
          maximum: 120
          description: At most 2 decimals
          minimum: 0.01
        spendCapCents:
          type: integer
          minimum: 100
          maximum: 50000
        requiredMinSavingsCents:
          type: integer
          minimum: 1
          maximum: 50000
          description: Mandatory minimum saving versus immediate charging; accept refuses
            offers that save less
    QuoteSet:
      type: object
      properties:
        quoteSetId:
          type: string
        stationId:
          type: string
        createdAtMs:
          type: integer
        expiresAtMs:
          type: integer
        offers:
          type: array
          items:
            $ref: "#/components/schemas/PricedOffer"
        rejected:
          type: array
          items:
            type: object
            properties:
              kind:
                type: string
              reason:
                type: string
        baseline:
          type: object
          description: Immediate-charging comparison
        assumptions:
          type: object
          description: Tariff, economics and forecast labels; provenance is SYNTHETIC
        requiredMinSavingsCents:
          type:
            - integer
            - "null"
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
    PricedOffer:
      type: object
      properties:
        offerId:
          type: string
        kind:
          type: string
          enum:
            - flex_lowest_cost
            - flex_early_finish
            - flex_gentle
        label:
          type: string
        chargeStartMs:
          type: integer
        chargeEndMs:
          type: integer
        listPriceCents:
          type: integer
        priceCents:
          type: integer
        discountCents:
          type: integer
        energyCostCents:
          type: integer
        operatorImprovementCents:
          type: integer
        powerW:
          type: array
          items:
            type: integer
        terms:
          $ref: "#/components/schemas/OfferTerms"
        termsHash:
          type: string
          pattern: ^[0-9a-f]{64}$
    OfferTerms:
      type: object
      description: The exact agreement. `termsHash` is the SHA-256 of its canonical JSON.
      properties:
        version:
          type: string
        quoteSetId:
          type: string
        offerId:
          type: string
        stationId:
          type: string
        merchantRef:
          type: string
        portId:
          type: string
        currency:
          type: string
          const: USD
        amountCents:
          type: integer
        listPriceCents:
          type: integer
        targetBatteryWh:
          type: integer
        plugInMs:
          type: integer
        departMs:
          type: integer
        gridStartMs:
          type: integer
        powerW:
          type: array
          items:
            type: integer
          description: Planned charging power per quarter-hour slot
        expiresAtMs:
          type: integer
  responses:
    ValidationError:
      description: Invalid input
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
    BadOrigin:
      description: Request origin not allowed
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
    RateLimited:
      description: Too many requests
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
info:
  title: GridWindow FlexPay API
  version: 1.0.0
```