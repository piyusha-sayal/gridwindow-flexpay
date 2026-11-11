# Find in-stock EV charging accessories across merchants (/api/openapi/gear/findEvGear)

`GET /api/gear`

Read-only product search through Channel3. Returns merchant links; nothing is bought. `enabled` is false when no Channel3 key is configured on the server.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/gear:
    get:
      tags:
        - Gear
      operationId: findEvGear
      summary: Find in-stock EV charging accessories across merchants
      description: Read-only product search through Channel3. Returns merchant links;
        nothing is bought. `enabled` is false when no Channel3 key is configured
        on the server.
      parameters:
        - name: q
          in: query
          required: false
          description: Search text; defaults to common EV charging accessories.
          schema:
            type: string
            maxLength: 200
          example: J1772 to Tesla adapter
        - name: maxPriceCents
          in: query
          required: false
          description: Price cap in US cents.
          schema:
            type: integer
            minimum: 100
            maximum: 500000
          example: 6000
        - name: limit
          in: query
          required: false
          description: Number of results (1-12).
          schema:
            type: integer
            minimum: 1
            maximum: 12
          example: 6
      responses:
        "200":
          description: Search result
          content:
            application/json:
              schema:
                type: object
                description: Gear search result
                properties:
                  enabled:
                    type: boolean
                    description: False when the server has no Channel3 key
                  items:
                    type: array
                    description: Products, cheapest in-stock offer each
                    items:
                      type: object
                      description: One product
                      properties:
                        id:
                          type: string
                          description: Channel3 product id
                        title:
                          type: string
                          description: Product title
                        brand:
                          type:
                            - string
                            - "null"
                          description: Brand name
                        imageUrl:
                          type:
                            - string
                            - "null"
                          description: Product image
                        priceCents:
                          type: integer
                          description: Price in US cents
                        compareAtCents:
                          type:
                            - integer
                            - "null"
                          description: Pre-discount price in cents
                        currency:
                          type: string
                          description: Currency code
                        url:
                          type: string
                          description: Merchant offer link
                        domain:
                          type: string
                          description: Merchant domain
        "429":
          $ref: "#/components/responses/RateLimited"
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.gear.find_ev_gear(
                      q="J1772 to Tesla adapter",
                      max_price_cents=6000,
                      limit=6,
                  )
                  # TODO: Handle 'response' of type ApiGearResponse
              except ApiError as e:
                  # TODO: Handle 'e.error' of type FindEvGearErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.gear.findEvGear({
                  q: "J1772 to Tesla adapter",
                  maxPriceCents: 6000,
                  limit: 6,
                });
                // TODO: Handle 'response' of type ApiGearResponse
              } catch (err) {
                // TODO: Handle 'err' of type Gear.FindEvGearError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
  responses:
    RateLimited:
      description: Too many requests
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
  schemas:
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
info:
  title: GridWindow FlexPay API
  version: 1.0.0
```