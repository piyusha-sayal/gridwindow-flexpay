# Ask a question about one of the caller's reservations (/api/openapi/ai/askAboutReservation)

`POST /api/assist/ask`

Ask a question about one of the caller's reservations.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/assist/ask:
    post:
      tags:
        - AI
      operationId: askAboutReservation
      summary: Ask a question about one of the caller's reservations
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required:
                - reservationId
                - question
              properties:
                reservationId:
                  type: string
                  maxLength: 64
                question:
                  type: string
                  minLength: 1
                  maxLength: 500
      responses:
        "200":
          description: Grounded answer and its source
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AskResult"
        "404":
          $ref: "#/components/responses/NotFound"
      description: Ask a question about one of the caller's reservations.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.ai_api.ask_about_reservation(
                      ApiAssistAskRequest(
                          reservation_id="some example string",
                          question="some example string",
                      ),
                  )
                  # TODO: Handle 'response' of type AskResult
              except ApiError as e:
                  # TODO: Handle 'e.error' of type
                  # AskAboutReservationErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.aiApi.askAboutReservation({
                  body: {
                    reservationId: "some example string",
                    question: "some example string",
                  },
                });
                // TODO: Handle 'response' of type AskResult
              } catch (err) {
                // TODO: Handle 'err' of type AiApi.AskAboutReservationError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
  schemas:
    AskResult:
      type: object
      required:
        - answer
        - inScope
        - source
      properties:
        answer:
          type: string
        inScope:
          type: boolean
          description: False when the question is outside what the assistant may answer
        source:
          $ref: "#/components/schemas/AiSourceKind"
        model:
          type: string
        reason:
          type: string
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
    AiSourceKind:
      type: string
      description: Which produced the text. A deterministic fallback is never
        presented as a model answer.
      enum:
        - MODEL
        - DETERMINISTIC_FALLBACK
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