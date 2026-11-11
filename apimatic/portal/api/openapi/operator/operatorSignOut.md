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
          description: Signed out
      description: Sign out.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  client.operator.operator_sign_out()
              except ApiError as e:
                  ...  # TODO: Handle 'e.error' of type RawError
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                await client.operator.operatorSignOut();
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