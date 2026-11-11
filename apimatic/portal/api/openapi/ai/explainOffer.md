# Explain one of the caller's offers in plain language (/api/openapi/ai/explainOffer)

`POST /api/assist/explain`

Numbers come from the stored quote; model text is checked against them before it is shown.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/assist/explain:
    post:
      tags:
        - AI
      operationId: explainOffer
      summary: Explain one of the caller's offers in plain language
      description: Numbers come from the stored quote; model text is checked against
        them before it is shown.
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
              properties:
                quoteSetId:
                  type: string
                  maxLength: 64
                offerId:
                  type: string
                  maxLength: 128
      responses:
        "200":
          description: Explanation and its source
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ExplainResult"
        "404":
          $ref: "#/components/responses/NotFound"
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.ai_api.explain_offer(
                      ApiAssistExplainRequest(
                          quote_set_id="some example string",
                          offer_id="some example string",
                      ),
                  )
                  # TODO: Handle 'response' of type ExplainResult
              except ApiError as e:
                  # TODO: Handle 'e.error' of type ExplainOfferErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.aiApi.explainOffer({
                  body: {
                    quoteSetId: "some example string",
                    offerId: "some example string",
                  },
                });
                // TODO: Handle 'response' of type ExplainResult
              } catch (err) {
                // TODO: Handle 'err' of type AiApi.ExplainOfferError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
  schemas:
    ExplainResult:
      type: object
      required:
        - summary
        - points
        - source
      properties:
        summary:
          type: string
        points:
          type: array
          items:
            type: string
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