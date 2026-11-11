# Ask the deal agent to pick one of the caller's offers for a goal (/api/openapi/ai/recommendOffer)

`POST /api/agent/deals`

Read-only. It evaluates only offers the backend already priced and never accepts or pays.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/agent/deals:
    post:
      tags:
        - AI
      operationId: recommendOffer
      summary: Ask the deal agent to pick one of the caller's offers for a goal
      description: Read-only. It evaluates only offers the backend already priced and
        never accepts or pays.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required:
                - quoteSetId
                - minSavingsCents
                - preference
              properties:
                quoteSetId:
                  type: string
                  maxLength: 64
                minSavingsCents:
                  type:
                    - integer
                    - "null"
                  minimum: 1
                  maximum: 50000
                preference:
                  type: string
                  enum:
                    - lowest_cost
                    - early_finish
                    - gentle
      responses:
        "200":
          description: The recommendation and the evaluation behind it
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DealResult"
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
                  response = client.ai_api.recommend_offer(
                      ApiAgentDealsRequest(
                          quote_set_id="some example string",
                          min_savings_cents=1,
                          preference=Preference.LOWEST_COST,
                      ),
                  )
                  # TODO: Handle 'response' of type DealResult
              except ApiError as e:
                  # TODO: Handle 'e.error' of type RecommendOfferErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.aiApi.recommendOffer({
                  body: {
                    quoteSetId: "some example string",
                    minSavingsCents: 1,
                    preference: Preference.LowestCost,
                  },
                });
                // TODO: Handle 'response' of type DealResult
              } catch (err) {
                // TODO: Handle 'err' of type AiApi.RecommendOfferError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
  schemas:
    DealResult:
      type: object
      properties:
        evaluation:
          type: object
          properties:
            status:
              type: string
              examples:
                - RECOMMENDED
                - NO_OFFERS
            recommendedOfferId:
              type:
                - string
                - "null"
            candidates:
              type: array
              items:
                type: object
            backendRejected:
              type: array
              items:
                type: object
        summary:
          type: string
          description: Plain-language recommendation; every figure comes from the
            server-priced quote
        points:
          type: array
          items:
            type: string
        source:
          $ref: "#/components/schemas/AiSourceKind"
        model:
          type: string
          description: Model that wrote the narrative (present when source is MODEL)
        reason:
          type: string
          description: Why the deterministic fallback answered (present when source is
            DETERMINISTIC_FALLBACK)
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