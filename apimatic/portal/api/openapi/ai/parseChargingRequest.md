# Turn a plain-language request into form fields (/api/openapi/ai/parseChargingRequest)

`POST /api/quotes/parse`

Fills a form only. It sets no price and approves nothing. Falls back to a labelled deterministic parser when no AI provider is available.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/quotes/parse:
    post:
      tags:
        - AI
      operationId: parseChargingRequest
      summary: Turn a plain-language request into form fields
      description: Fills a form only. It sets no price and approves nothing. Falls
        back to a labelled deterministic parser when no AI provider is
        available.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required:
                - text
              properties:
                text:
                  type: string
                  maxLength: 1000
                  examples:
                    - Find me 30 kWh before 7 AM and save at least $4
      responses:
        "200":
          description: Parsed fields and their source
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ParseResult"
        "400":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimited"
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.ai_api.parse_charging_request(
                      ApiQuotesParseRequest(text="some example string")
                  )
                  # TODO: Handle 'response' of type ParseResult
              except ApiError as e:
                  # TODO: Handle 'e.error' of type
                  # ParseChargingRequestErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.aiApi.parseChargingRequest({
                  body: { text: "some example string" },
                });
                // TODO: Handle 'response' of type ParseResult
              } catch (err) {
                // TODO: Handle 'err' of type AiApi.ParseChargingRequestError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
  schemas:
    ParseResult:
      type: object
      properties:
        parsed:
          type: object
          description: "Fields to pre-fill: targetBatteryKWh, departLocal,
            minSavingsCents, preference, notes"
        source:
          type: string
          examples:
            - MODEL
            - DETERMINISTIC_FALLBACK
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
  responses:
    ValidationError:
      description: Invalid input
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