<!-- Generated file — do not edit; regenerated with the SDK. -->

# Offers — operations

Accessor: `client.offers` · Source: `src/resources/offers.ts` · 1 operation · Request and error types: namespace `Offers`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `grid-window-flex-pay-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### requestOffers

- **Signature**: `requestOffers(request: Offers.RequestOffersRequest, options?: RequestOptions): ApiPromise<ApiQuotesResponse, Offers.RequestOffersError>`
- **Wire**: `POST /api/quotes`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ApiQuotesResponse`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `Offers.RequestOffersError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [400] `Error` · `"error2"` [403] `Error` · `"error3"` [409] `Error` · `"error4"` [429] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Offers.RequestOffersRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `QuoteRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `QuoteRequest` | `quoteRequestSchema` | `src/models/quote-request.ts` |
| `ApiQuotesResponse` | `apiQuotesResponseSchema` | `src/models/api-quotes-response.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

