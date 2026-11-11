<!-- Generated file — do not edit; regenerated with the SDK. -->

# Operator — operations

Accessor: `client.operator` · Source: `src/resources/operator.ts` · 4 operations · Request and error types: namespace `Operator`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `grid-window-flex-pay-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### getOperatorDashboard

- **Signature**: `getOperatorDashboard(request?: Operator.GetOperatorDashboardRequest, options?: RequestOptions): ApiPromise<Record<string, unknown>, Operator.GetOperatorDashboardError>`
- **Wire**: `GET /api/operator/dashboard`
- **Auth**: `operatorCookie`
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Record<string, unknown>` — a bare `application/json` map; the success type *is* the map
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `Operator.GetOperatorDashboardError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [401] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Operator.GetOperatorDashboardRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `night` | `query` | `string` | no |

| Type | Schema value | Source |
| --- | --- | --- |
| `Error` | `errorSchema` | `src/models/error.ts` |

### getOperatorSession

- **Signature**: `getOperatorSession(options?: RequestOptions): ApiPromise<ApiOperatorSessionResponse, ApiError>`
- **Wire**: `GET /api/operator/session`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiOperatorSessionResponse`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"` — untyped, `payload.kind` always `"undeclared"`

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiOperatorSessionResponse` | `apiOperatorSessionResponseSchema` | `src/models/api-operator-session-response.ts` |

### operatorSignIn

- **Signature**: `operatorSignIn(request: Operator.OperatorSignInRequest, options?: RequestOptions): ApiPromise<OperatorSessionState, Operator.OperatorSignInError>`
- **Wire**: `POST /api/operator/session`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `OperatorSessionState`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `Operator.OperatorSignInError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [401] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Operator.OperatorSignInRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiOperatorSessionRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiOperatorSessionRequest` | `apiOperatorSessionRequestSchema` | `src/models/api-operator-session-request.ts` |
| `OperatorSessionState` | `operatorSessionStateSchema` | `src/models/operator-session-state.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### operatorSignOut

- **Signature**: `operatorSignOut(options?: RequestOptions): ApiPromise<OperatorSessionState, ApiError>`
- **Wire**: `DELETE /api/operator/session`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `OperatorSessionState`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"` — untyped, `payload.kind` always `"undeclared"`

| Type | Schema value | Source |
| --- | --- | --- |
| `OperatorSessionState` | `operatorSessionStateSchema` | `src/models/operator-session-state.ts` |

