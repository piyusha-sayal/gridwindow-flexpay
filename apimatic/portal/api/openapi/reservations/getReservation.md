# One reservation with payment state, provider proofs and receipt data (/api/openapi/reservations/getReservation)

`GET /api/reservations/{id}`

One reservation with payment state, provider proofs and receipt data.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/reservations/{id}:
    get:
      tags:
        - Reservations
      operationId: getReservation
      summary: One reservation with payment state, provider proofs and receipt data
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: The reservation
          content:
            application/json:
              schema:
                type: object
                properties:
                  reservation:
                    $ref: "#/components/schemas/ReservationView"
        "404":
          $ref: "#/components/responses/NotFound"
      description: One reservation with payment state, provider proofs and receipt data.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.reservations.get_reservation(
                      "some example string"
                  )
                  # TODO: Handle 'response' of type
                  # ApiReservationsResponse1
              except ApiError as e:
                  # TODO: Handle 'e.error' of type GetReservationErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.reservations.getReservation(
                  { id: "some example string" },
                );
                // TODO: Handle 'response' of type ApiReservationsResponse1
              } catch (err) {
                // TODO: Handle 'err' of type Reservations.GetReservationError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
  schemas:
    ReservationView:
      type: object
      properties:
        id:
          type: string
        providerMode:
          $ref: "#/components/schemas/ProviderMode"
        paymentState:
          $ref: "#/components/schemas/PaymentState"
        serviceState:
          $ref: "#/components/schemas/ServiceState"
        slotsCommitted:
          type: boolean
        portLabel:
          type: string
        merchantName:
          type: string
        timeZone:
          type: string
        plugInMs:
          type: integer
        departMs:
          type: integer
        targetBatteryWh:
          type: integer
        powerW:
          type: array
          items:
            type: integer
        termsHash:
          type: string
        economics:
          type: object
          properties:
            listPriceCents:
              type: integer
            priceCents:
              type: integer
            discountCents:
              type: integer
            energyCostCents:
              type: integer
            baselineEnergyCostCents:
              type:
                - integer
                - "null"
            operatorImprovementCents:
              type: integer
        proofs:
          type: array
          items:
            $ref: "#/components/schemas/ProofView"
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
    ProviderMode:
      type: string
      enum:
        - PAYPAL_SANDBOX
        - MOCK
    PaymentState:
      type: string
      enum:
        - QUOTE_ACCEPTED
        - ORDER_CREATED
        - BUYER_APPROVED
        - AUTHORIZED
        - CAPTURE_PENDING
        - CAPTURED
        - CAPTURE_DECLINED
        - VOIDED
        - CANCELLED
        - FAILED
        - NEEDS_RECONCILIATION
    ServiceState:
      type: string
      enum:
        - AWAITING_PAYMENT
        - SCHEDULED
        - DELIVERED
        - FAILED
        - CANCELLED
    ProofView:
      type: object
      description: Provider evidence read back from PayPal (or MOCK) before any paid
        or voided label
      properties:
        type:
          type: string
          examples:
            - BUYER_APPROVED
            - AUTHORIZED
            - CAPTURED
            - VOIDED
        ref:
          type: string
        status:
          type: string
        amountCents:
          type: integer
  responses:
    NotFound:
      description: Not found (or not the caller's)
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
info:
  title: GridWindow FlexPay API
  version: 1.0.0
```