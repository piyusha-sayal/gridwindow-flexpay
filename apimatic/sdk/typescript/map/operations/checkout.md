<!-- Generated file — do not edit; regenerated with the SDK. -->

# Checkout — operations

Accessor: `client.checkout` · Source: `src/resources/checkout.ts` · 3 operations · Request and error types: namespace `Checkout`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `grid-window-flex-pay-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### acceptOffer

- **Signature**: `acceptOffer(request: Checkout.AcceptOfferRequest, options?: RequestOptions): ApiPromise<ApiOffersAcceptResponse, Checkout.AcceptOfferError>`
- **Wire**: `POST /api/offers/accept`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiOffersAcceptResponse`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `Checkout.AcceptOfferError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [404] `Error` · `"error2"` [409] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Checkout.AcceptOfferRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiOffersAcceptRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiOffersAcceptRequest` | `apiOffersAcceptRequestSchema` | `src/models/api-offers-accept-request.ts` |
| `ApiOffersAcceptResponse` | `apiOffersAcceptResponseSchema` | `src/models/api-offers-accept-response.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### checkoutCancel

- **Signature**: `checkoutCancel(request: Checkout.CheckoutCancelRequest, options?: RequestOptions): ApiPromise<undefined, Checkout.CheckoutCancelError>`
- **Wire**: `GET /api/checkout/cancel`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `undefined` — the operation resolves to nothing
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `Checkout.CheckoutCancelError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error303"` [303] no body · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Checkout.CheckoutCancelRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `rid` | `query` | `string` | yes |
| `state` | `query` | `string` | yes |

### checkoutReturn

- **Signature**: `checkoutReturn(request: Checkout.CheckoutReturnRequest, options?: RequestOptions): ApiPromise<undefined, Checkout.CheckoutReturnError>`
- **Wire**: `GET /api/checkout/return`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `undefined` — the operation resolves to nothing
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `Checkout.CheckoutReturnError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error303"` [303] no body · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Checkout.CheckoutReturnRequest` (3):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `rid` | `query` | `string` | yes |
| `state` | `query` | `string` | yes |
| `token` | `query` | `string` | yes |

