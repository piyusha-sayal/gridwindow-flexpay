# Sign out (/api/openapi/operator/operatorSignOut)

`DELETE /api/operator/session`

Sign out.

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
    delete:
      tags:
        - Operator
      operationId: operatorSignOut
      summary: Sign out
      responses:
        "200":
          description: Signed out; clears the operator cookie
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/OperatorSessionState"
      description: Sign out.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  response = client.operator.operator_sign_out()
                  # TODO: Handle 'response' of type OperatorSessionState
              except ApiError as e:
                  ...  # TODO: Handle 'e.error' of type RawError
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                const response = await client.operator.operatorSignOut();
                // TODO: Handle 'response' of type OperatorSessionState
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
    OperatorSessionState:
      type: object
      required:
        - operator
      properties:
        operator:
          type: boolean
          description: Whether the caller holds an operator session after this call
info:
  title: GridWindow FlexPay API
  version: 1.0.0
```