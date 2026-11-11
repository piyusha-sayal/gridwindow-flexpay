<!-- Generated file — do not edit; regenerated with the SDK. -->

# AiApi — operations

Accessor: `client.aiApi` · Source: `src/resources/ai-api.ts` · 4 operations · Request and error types: namespace `AiApi`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `grid-window-flex-pay-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### askAboutReservation

- **Signature**: `askAboutReservation(request: AiApi.AskAboutReservationRequest, options?: RequestOptions): ApiPromise<AskResult, AiApi.AskAboutReservationError>`
- **Wire**: `POST /api/assist/ask`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `AskResult`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `AiApi.AskAboutReservationError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [404] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `AiApi.AskAboutReservationRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiAssistAskRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAssistAskRequest` | `apiAssistAskRequestSchema` | `src/models/api-assist-ask-request.ts` |
| `AskResult` | `askResultSchema` | `src/models/ask-result.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### explainOffer

- **Signature**: `explainOffer(request: AiApi.ExplainOfferRequest, options?: RequestOptions): ApiPromise<ExplainResult, AiApi.ExplainOfferError>`
- **Wire**: `POST /api/assist/explain`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ExplainResult`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `AiApi.ExplainOfferError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [404] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `AiApi.ExplainOfferRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiAssistExplainRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAssistExplainRequest` | `apiAssistExplainRequestSchema` | `src/models/api-assist-explain-request.ts` |
| `ExplainResult` | `explainResultSchema` | `src/models/explain-result.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### parseChargingRequest

- **Signature**: `parseChargingRequest(request: AiApi.ParseChargingRequestRequest, options?: RequestOptions): ApiPromise<ParseResult, AiApi.ParseChargingRequestError>`
- **Wire**: `POST /api/quotes/parse`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `ParseResult`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `AiApi.ParseChargingRequestError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [400] `Error` · `"error2"` [429] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `AiApi.ParseChargingRequestRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiQuotesParseRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiQuotesParseRequest` | `apiQuotesParseRequestSchema` | `src/models/api-quotes-parse-request.ts` |
| `ParseResult` | `parseResultSchema` | `src/models/parse-result.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### recommendOffer

- **Signature**: `recommendOffer(request: AiApi.RecommendOfferRequest, options?: RequestOptions): ApiPromise<DealResult, AiApi.RecommendOfferError>`
- **Wire**: `POST /api/agent/deals`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `DealResult`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `AiApi.RecommendOfferError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [404] `Error` · `"error2"` [409] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `AiApi.RecommendOfferRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `body` | `body` | `ApiAgentDealsRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiAgentDealsRequest` | `apiAgentDealsRequestSchema` | `src/models/api-agent-deals-request.ts` |
| `DealResult` | `dealResultSchema` | `src/models/deal-result.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

