# Sign in with the operator passphrase (/api/openapi/operator/operatorSignIn)

`POST /api/operator/session`

Sign in with the operator passphrase.

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
    post:
      tags:
        - Operator
      operationId: operatorSignIn
      summary: Sign in with the operator passphrase
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required:
                - passphrase
              properties:
                passphrase:
                  type: string
                  minLength: 1
                  maxLength: 256
      responses:
        "200":
          description: Signed in; sets the operator cookie
        "401":
          $ref: "#/components/responses/Unauthorized"
      description: Sign in with the operator passphrase.
      x-apimatic-codeSamples:
        - lang: python
          label: Python
          sources:
            Example: |-
              try:
                  client.operator.operator_sign_in(
                      ApiOperatorSessionRequest(
                          passphrase="some example string"
                      ),
                  )
              except ApiError as e:
                  # TODO: Handle 'e.error' of type OperatorSignInErrorBody
                  ...
        - lang: typescript
          label: TypeScript
          sources:
            Example: >-
              try {
                await client.operator.operatorSignIn({
                  body: { passphrase: "some example string" },
                });
              } catch (err) {
                // TODO: Handle 'err' of type Operator.OperatorSignInError, discriminated with 'err.payload.kind'
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