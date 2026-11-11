<!-- Generated file - do not edit; regenerated with the SDK. -->

# Site - operations

Accessor: `client.site` · Source: `src/resources/site.ts` · 1 operation · Request types: namespace `Site`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `grid-window-flex-pay-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded - see sdk-map.md.

### getSiteConfig

- **Signature**: `getSiteConfig(options?: RequestOptions): ApiPromise<SiteConfig, ApiError>`
- **Wire**: `GET /api/config`
- **Auth**: none - public; no credential is sent
- **Request body**: none - no `Content-Type` header is sent
- **Returns**: `SiteConfig`
- **Error**: `GridWindowFlexPayApiError` with `kind: "api"` - untyped, `payload.kind` always `"undeclared"`

| Type | Schema value | Source |
| --- | --- | --- |
| `SiteConfig` | `siteConfigSchema` | `src/models/site-config.ts` |

