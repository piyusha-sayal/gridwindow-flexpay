# Station, ports, payment mode, AI status and the default charging window (/api/openapi/site/getSiteConfig)

`GET /api/config`

Station, ports, payment mode, AI status and the default charging window.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/config:
    get:
      tags:
        - Site
      operationId: getSiteConfig
      summary: Station, ports, payment mode, AI status and the default charging window
      responses:
        "200":
          description: Site configuration
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SiteConfig"
      description: Station, ports, payment mode, AI status and the default charging window.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.site.get_site_config()
                  # TODO: Handle 'response' of type SiteConfig
              except ApiError as e:
                  ...  # TODO: Handle 'e.error' of type RawError
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.site.getSiteConfig();
                // TODO: Handle 'response' of type SiteConfig
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
    SiteConfig:
      type: object
      properties:
        providerMode:
          $ref: "#/components/schemas/ProviderMode"
        station:
          type: object
          properties:
            name:
              type: string
            timeZone:
              type: string
              examples:
                - America/Los_Angeles
            stationCapW:
              type: integer
            ports:
              type: array
              items:
                type: object
        ai:
          type: object
          properties:
            enabled:
              type: boolean
            model:
              type:
                - string
                - "null"
        defaultNightOf:
          type: string
          format: date
        defaultPlugInLocal:
          type: string
          pattern: ^\d{2}:\d{2}$
        defaultDepartLocal:
          type: string
          pattern: ^\d{2}:\d{2}$
    ProviderMode:
      type: string
      enum:
        - PAYPAL_SANDBOX
        - MOCK
info:
  title: GridWindow FlexPay API
  version: 1.0.0
```