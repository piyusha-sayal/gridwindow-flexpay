# Whether the caller holds an operator session (/api/openapi/operator/getOperatorSession)

`GET /api/operator/session`

Whether the caller holds an operator session.

```yaml
openapi: 3.2.0
servers:
  - url: https://gridwindow-flexpay.onrender.com
    description: Hosted demo (Render free tier; the first request after idle wakes
      the service)
  - url: http://localhost:3000
    description: Local development
paths:
  /api/operator/session:
    get:
      tags:
        - Operator
      operationId: getOperatorSession
      summary: Whether the caller holds an operator session
      responses:
        "200":
          description: Session state
          content:
            application/json:
              schema:
                type: object
                properties:
                  operator:
                    type: boolean
      description: Whether the caller holds an operator session.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.operator.get_operator_session()
                  # TODO: Handle 'response' of type
                  # ApiOperatorSessionResponse
              except ApiError as e:
                  ...  # TODO: Handle 'e.error' of type RawError
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response =
                  await client.operator.getOperatorSession();
                // TODO: Handle 'response' of type ApiOperatorSessionResponse
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
info:
  title: GridWindow FlexPay API
  version: 1.0.0
```