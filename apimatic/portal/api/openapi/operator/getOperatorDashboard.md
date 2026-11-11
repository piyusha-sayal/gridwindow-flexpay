# Every reservation of a night with load, ports and payment states (/api/openapi/operator/getOperatorDashboard)

`GET /api/operator/dashboard`

Every reservation of a night with load, ports and payment states.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/operator/dashboard:
    get:
      tags:
        - Operator
      operationId: getOperatorDashboard
      summary: Every reservation of a night with load, ports and payment states
      security:
        - operatorCookie: []
      parameters:
        - name: nightOf
          in: query
          required: false
          schema:
            type: string
            pattern: ^\d{4}-\d{2}-\d{2}$
      responses:
        "200":
          description: Dashboard data
          content:
            application/json:
              schema:
                type: object
        "401":
          $ref: "#/components/responses/Unauthorized"
      description: Every reservation of a night with load, ports and payment states.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.operator.get_operator_dashboard()
                  # TODO: Handle 'response' of type Any
              except ApiError as e:
                  # TODO: Handle 'e.error' of type
                  # GetOperatorDashboardErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response =
                  await client.operator.getOperatorDashboard();
                // TODO: Handle 'response' of type Record<string, unknown>
              } catch (err) {
                // TODO: Handle 'err' of type Operator.GetOperatorDashboardError, discriminated with 'err.payload.kind'
              }
components:
  securitySchemes:
    operatorCookie:
      type: apiKey
      in: cookie
      name: gw_op
      description: Signed operator session cookie set by POST /api/operator/session.
  responses:
    Unauthorized:
      description: Operator session required or passphrase wrong
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