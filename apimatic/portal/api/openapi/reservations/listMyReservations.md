# Reservations made in the caller's driver session (/api/openapi/reservations/listMyReservations)

`GET /api/reservations`

Reservations made in the caller's driver session.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/reservations:
    get:
      tags:
        - Reservations
      operationId: listMyReservations
      summary: Reservations made in the caller's driver session
      responses:
        "200":
          description: The caller's reservations (empty without a session)
          content:
            application/json:
              schema:
                type: object
                properties:
                  reservations:
                    type: array
                    items:
                      $ref: "#/components/schemas/ReservationView"
      description: Reservations made in the caller's driver session.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.reservations.list_my_reservations()
                  # TODO: Handle 'response' of type
                  # ApiReservationsResponse
              except ApiError as e:
                  ...  # TODO: Handle 'e.error' of type RawError
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response =
                  await client.reservations.listMyReservations();
                // TODO: Handle 'response' of type ApiReservationsResponse
              } catch (err) {
                // TODO: Handle 'err' of type ApiError, where 'err.payload' is always the Undeclared arm
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
info:
  title: GridWindow FlexPay API
  version: 1.0.0
```