<!-- Generated file — do not edit; regenerated with the SDK. -->

# Gear — operations

Accessor: `client.gear` · Source: `src/resources/gear.ts` · 1 operation · Request and error types: namespace `Gear`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `grid-window-flex-pay-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### findEvGear

- **Signature**: `findEvGear(request?: Gear.FindEvGearRequest, options?: RequestOptions): ApiPromise<ApiGearResponse, Gear.FindEvGearError>`
- **Wire**: `GET /api/gear`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ApiGearResponse`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"`, an instance of `Gear.FindEvGearError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [429] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Gear.FindEvGearRequest` (3):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `q` | `query` | `string` | no |
| `maxPriceCents` | `query` | `number` | no |
| `limit` | `query` | `number` | no |

| Type | Schema value | Source |
| --- | --- | --- |
| `ApiGearResponse` | `apiGearResponseSchema` | `src/models/api-gear-response.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

