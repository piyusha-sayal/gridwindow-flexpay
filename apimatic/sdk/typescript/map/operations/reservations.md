<!-- Generated file — do not edit; regenerated with the SDK. -->

# Reservations — operations

Accessor: `client.reservations` · Source: `src/resources/reservations.ts` · 2 operations · Request and error types: namespace `Reservations`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `grid-window-flex-pay-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### getReservation

- **Signature**: `getReservation(request: Reservations.GetReservationRequest, options?: RequestOptions): ApiPromise<ApiReservationsResponse1, Reservations.GetReservationError>`
- **Wire**: `GET /api/reservations/{id}`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiReservationsResponse1`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `Reservations.GetReservationError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [404] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Reservations.GetReservationRequest` (1):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `id` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiReservationsResponse1` | `apiReservationsResponse1Schema` | `src/models/api-reservations-response1.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### listMyReservations

- **Signature**: `listMyReservations(options?: RequestOptions): ApiPromise<ApiReservationsResponse, ApiError>`
- **Wire**: `GET /api/reservations`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiReservationsResponse`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"` — untyped, `payload.kind` always `"undeclared"`

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiReservationsResponse` | `apiReservationsResponseSchema` | `src/models/api-reservations-response.ts` |

