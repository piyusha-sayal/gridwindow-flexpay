# Reference

> Source: [GridWindowFlexPayApiClient](src/client.ts)

## Site

> Source: [Site](src/resources/site.ts)

<details>
<summary><code>getSiteConfig(options?: RequestOptions): ApiPromise&lt;SiteConfig, ApiError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Station, ports, payment mode, AI status and the default charging window.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.site.getSiteConfig();
  // TODO: Handle 'response' of type SiteConfig
} catch (err) {
  // TODO: Handle 'err' of type ApiError, where 'err.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.site.getSiteConfig().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type SiteConfig
} else {
  // TODO: Handle 'result', where 'result.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.site.getSiteConfig()`

- **OnSuccess**: <code>[SiteConfig](src/models/site-config.ts)</code>
- **OnError**: throws <code>[ApiError](src/core/api-error.ts)</code>, with `err.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm

**As ApiResult**: `await client.site.getSiteConfig().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;SiteConfig, ApiError&gt;</code>, with `result.value` of type <code>[SiteConfig](src/models/site-config.ts)</code>
- **OnError**: `result.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Offers

> Source: [Offers](src/resources/offers.ts)

<details>
<summary><code>requestOffers(request: Offers.RequestOffersRequest, options?: RequestOptions): ApiPromise&lt;ApiQuotesResponse, Offers.RequestOffersError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Creates the driver session cookie if absent. Each offer carries exact terms and their SHA-256 `termsHash`, which accept must echo.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.offers.requestOffers({
    body: {
      portId: "some example string",
      nightOf: "some example string",
      plugInLocal: "some example string",
      departLocal: "some example string",
      targetBatteryKWh: 1.5,
      spendCapCents: 1,
    },
  });
  // TODO: Handle 'response' of type ApiQuotesResponse
} catch (err) {
  // TODO: Handle 'err' of type Offers.RequestOffersError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.offers
  .requestOffers({
    body: {
      portId: "some example string",
      nightOf: "some example string",
      plugInLocal: "some example string",
      departLocal: "some example string",
      targetBatteryKWh: 1.5,
      spendCapCents: 1,
    },
  })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiQuotesResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[QuoteRequest](src/models/quote-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.offers.requestOffers(request)`

- **OnSuccess**: <code>[ApiQuotesResponse](src/models/api-quotes-response.ts)</code>
- **OnError**: throws <code>[Offers.RequestOffersError](src/resources/offers.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.offers.requestOffers(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiQuotesResponse, Offers.RequestOffersError&gt;</code>, with `result.value` of type <code>[ApiQuotesResponse](src/models/api-quotes-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## AiApi

> Source: [AiApi](src/resources/ai-api.ts)

<details>
<summary><code>askAboutReservation(request: AiApi.AskAboutReservationRequest, options?: RequestOptions): ApiPromise&lt;AskResult, AiApi.AskAboutReservationError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Ask a question about one of the caller's reservations.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.aiApi.askAboutReservation({
    body: { reservationId: "some example string", question: "some example string" },
  });
  // TODO: Handle 'response' of type AskResult
} catch (err) {
  // TODO: Handle 'err' of type AiApi.AskAboutReservationError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.aiApi
  .askAboutReservation({ body: { reservationId: "some example string", question: "some example string" } })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type AskResult
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiAssistAskRequest](src/models/api-assist-ask-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.aiApi.askAboutReservation(request)`

- **OnSuccess**: <code>[AskResult](src/models/ask-result.ts)</code>
- **OnError**: throws <code>[AiApi.AskAboutReservationError](src/resources/ai-api.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.aiApi.askAboutReservation(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;AskResult, AiApi.AskAboutReservationError&gt;</code>, with `result.value` of type <code>[AskResult](src/models/ask-result.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>explainOffer(request: AiApi.ExplainOfferRequest, options?: RequestOptions): ApiPromise&lt;ExplainResult, AiApi.ExplainOfferError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Numbers come from the stored quote; model text is checked against them before it is shown.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.aiApi.explainOffer({
    body: { quoteSetId: "some example string", offerId: "some example string" },
  });
  // TODO: Handle 'response' of type ExplainResult
} catch (err) {
  // TODO: Handle 'err' of type AiApi.ExplainOfferError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.aiApi
  .explainOffer({ body: { quoteSetId: "some example string", offerId: "some example string" } })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ExplainResult
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiAssistExplainRequest](src/models/api-assist-explain-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.aiApi.explainOffer(request)`

- **OnSuccess**: <code>[ExplainResult](src/models/explain-result.ts)</code>
- **OnError**: throws <code>[AiApi.ExplainOfferError](src/resources/ai-api.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.aiApi.explainOffer(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ExplainResult, AiApi.ExplainOfferError&gt;</code>, with `result.value` of type <code>[ExplainResult](src/models/explain-result.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>parseChargingRequest(request: AiApi.ParseChargingRequestRequest, options?: RequestOptions): ApiPromise&lt;ParseResult, AiApi.ParseChargingRequestError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Fills a form only. It sets no price and approves nothing. Falls back to a labelled deterministic parser when no AI provider is available.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.aiApi.parseChargingRequest({ body: { text: "some example string" } });
  // TODO: Handle 'response' of type ParseResult
} catch (err) {
  // TODO: Handle 'err' of type AiApi.ParseChargingRequestError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.aiApi
  .parseChargingRequest({ body: { text: "some example string" } })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ParseResult
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiQuotesParseRequest](src/models/api-quotes-parse-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.aiApi.parseChargingRequest(request)`

- **OnSuccess**: <code>[ParseResult](src/models/parse-result.ts)</code>
- **OnError**: throws <code>[AiApi.ParseChargingRequestError](src/resources/ai-api.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.aiApi.parseChargingRequest(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ParseResult, AiApi.ParseChargingRequestError&gt;</code>, with `result.value` of type <code>[ParseResult](src/models/parse-result.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>recommendOffer(request: AiApi.RecommendOfferRequest, options?: RequestOptions): ApiPromise&lt;DealResult, AiApi.RecommendOfferError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Read-only. It evaluates only offers the backend already priced and never accepts or pays.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.aiApi.recommendOffer({
    body: { quoteSetId: "some example string", minSavingsCents: 1, preference: Preference.LowestCost },
  });
  // TODO: Handle 'response' of type DealResult
} catch (err) {
  // TODO: Handle 'err' of type AiApi.RecommendOfferError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.aiApi
  .recommendOffer({
    body: { quoteSetId: "some example string", minSavingsCents: 1, preference: Preference.LowestCost },
  })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type DealResult
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiAgentDealsRequest](src/models/api-agent-deals-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.aiApi.recommendOffer(request)`

- **OnSuccess**: <code>[DealResult](src/models/deal-result.ts)</code>
- **OnError**: throws <code>[AiApi.RecommendOfferError](src/resources/ai-api.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.aiApi.recommendOffer(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;DealResult, AiApi.RecommendOfferError&gt;</code>, with `result.value` of type <code>[DealResult](src/models/deal-result.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Checkout

> Source: [Checkout](src/resources/checkout.ts)

<details>
<summary><code>acceptOffer(request: Checkout.AcceptOfferRequest, options?: RequestOptions): ApiPromise&lt;ApiOffersAcceptResponse, Checkout.AcceptOfferError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Requires the driver's explicit consent (`consent: true`) and the `termsHash` the driver saw; tampered or expired
terms are refused. Returns the PayPal approval link. Nothing is authorized or charged until the buyer approves in PayPal.


</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.checkout.acceptOffer({
    body: {
      quoteSetId: "some example string",
      offerId: "some example string",
      termsHash: "some example string",
      consent: true,
    },
  });
  // TODO: Handle 'response' of type ApiOffersAcceptResponse
} catch (err) {
  // TODO: Handle 'err' of type Checkout.AcceptOfferError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.checkout
  .acceptOffer({
    body: {
      quoteSetId: "some example string",
      offerId: "some example string",
      termsHash: "some example string",
      consent: true,
    },
  })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiOffersAcceptResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiOffersAcceptRequest](src/models/api-offers-accept-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.checkout.acceptOffer(request)`

- **OnSuccess**: <code>[ApiOffersAcceptResponse](src/models/api-offers-accept-response.ts)</code>
- **OnError**: throws <code>[Checkout.AcceptOfferError](src/resources/checkout.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.checkout.acceptOffer(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiOffersAcceptResponse, Checkout.AcceptOfferError&gt;</code>, with `result.value` of type <code>[ApiOffersAcceptResponse](src/models/api-offers-accept-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>checkoutCancel(request: Checkout.CheckoutCancelRequest, options?: RequestOptions): ApiPromise&lt;undefined, Checkout.CheckoutCancelError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

PayPal cancel URL. Cancels the pending order, then redirects to the reservation.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  await client.checkout.checkoutCancel({ rid: "some example string", state: "some example string" });
} catch (err) {
  // TODO: Handle 'err' of type Checkout.CheckoutCancelError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.checkout
  .checkoutCancel({ rid: "some example string", state: "some example string" })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: The call succeeded and resolves to no body
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>rid</code> | <code>string</code> | - |
| <code>state</code> | <code>string</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.checkout.checkoutCancel(request)`

- **OnSuccess**: <code>undefined</code>
- **OnError**: throws <code>[Checkout.CheckoutCancelError](src/resources/checkout.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.checkout.checkoutCancel(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;undefined, Checkout.CheckoutCancelError&gt;</code>, with `result.value` of type <code>undefined</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>checkoutReturn(request: Checkout.CheckoutReturnRequest, options?: RequestOptions): ApiPromise&lt;undefined, Checkout.CheckoutReturnError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

PayPal return URL. Authorizes the approved order, then redirects to the reservation.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  await client.checkout.checkoutReturn({
    rid: "some example string",
    state: "some example string",
    token: "some example string",
  });
} catch (err) {
  // TODO: Handle 'err' of type Checkout.CheckoutReturnError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.checkout
  .checkoutReturn({ rid: "some example string", state: "some example string", token: "some example string" })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: The call succeeded and resolves to no body
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>rid</code> | <code>string</code> | - |
| <code>state</code> | <code>string</code> | Signed anti-forgery state |
| <code>token</code> | <code>string</code> | PayPal order id |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.checkout.checkoutReturn(request)`

- **OnSuccess**: <code>undefined</code>
- **OnError**: throws <code>[Checkout.CheckoutReturnError](src/resources/checkout.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.checkout.checkoutReturn(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;undefined, Checkout.CheckoutReturnError&gt;</code>, with `result.value` of type <code>undefined</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Reservations

> Source: [Reservations](src/resources/reservations.ts)

<details>
<summary><code>getReservation(request: Reservations.GetReservationRequest, options?: RequestOptions): ApiPromise&lt;ApiReservationsResponse1, Reservations.GetReservationError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

One reservation with payment state, provider proofs and receipt data.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.reservations.getReservation({ id: "some example string" });
  // TODO: Handle 'response' of type ApiReservationsResponse1
} catch (err) {
  // TODO: Handle 'err' of type Reservations.GetReservationError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.reservations.getReservation({ id: "some example string" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiReservationsResponse1
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>id</code> | <code>string</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.reservations.getReservation(request)`

- **OnSuccess**: <code>[ApiReservationsResponse1](src/models/api-reservations-response1.ts)</code>
- **OnError**: throws <code>[Reservations.GetReservationError](src/resources/reservations.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.reservations.getReservation(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiReservationsResponse1, Reservations.GetReservationError&gt;</code>, with `result.value` of type <code>[ApiReservationsResponse1](src/models/api-reservations-response1.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>listMyReservations(options?: RequestOptions): ApiPromise&lt;ApiReservationsResponse, ApiError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Reservations made in the caller's driver session.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.reservations.listMyReservations();
  // TODO: Handle 'response' of type ApiReservationsResponse
} catch (err) {
  // TODO: Handle 'err' of type ApiError, where 'err.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.reservations.listMyReservations().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiReservationsResponse
} else {
  // TODO: Handle 'result', where 'result.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.reservations.listMyReservations()`

- **OnSuccess**: <code>[ApiReservationsResponse](src/models/api-reservations-response.ts)</code>
- **OnError**: throws <code>[ApiError](src/core/api-error.ts)</code>, with `err.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm

**As ApiResult**: `await client.reservations.listMyReservations().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiReservationsResponse, ApiError&gt;</code>, with `result.value` of type <code>[ApiReservationsResponse](src/models/api-reservations-response.ts)</code>
- **OnError**: `result.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Operator

> Source: [Operator](src/resources/operator.ts)

<details>
<summary><code>getOperatorDashboard(request?: Operator.GetOperatorDashboardRequest, options?: RequestOptions): ApiPromise&lt;Record&lt;string, unknown&gt;, Operator.GetOperatorDashboardError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Every reservation of a night with load, ports and payment states.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.getOperatorDashboard({ night: "2026-11-12" });
  // TODO: Handle 'response' of type Record<string, unknown>
} catch (err) {
  // TODO: Handle 'err' of type Operator.GetOperatorDashboardError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.getOperatorDashboard({ night: "2026-11-12" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Record<string, unknown>
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>night?</code> | <code>string</code> | Night to show (YYYY-MM-DD, station-local). Defaults to the current charging night. |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.getOperatorDashboard(request)`

- **OnSuccess**: <code>Record&lt;string, unknown&gt;</code>
- **OnError**: throws <code>[Operator.GetOperatorDashboardError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.getOperatorDashboard(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Record&lt;string, unknown&gt;, Operator.GetOperatorDashboardError&gt;</code>, with `result.value` of type <code>Record&lt;string, unknown&gt;</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getOperatorSession(options?: RequestOptions): ApiPromise&lt;ApiOperatorSessionResponse, ApiError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Whether the caller holds an operator session.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.getOperatorSession();
  // TODO: Handle 'response' of type ApiOperatorSessionResponse
} catch (err) {
  // TODO: Handle 'err' of type ApiError, where 'err.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.getOperatorSession().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiOperatorSessionResponse
} else {
  // TODO: Handle 'result', where 'result.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.getOperatorSession()`

- **OnSuccess**: <code>[ApiOperatorSessionResponse](src/models/api-operator-session-response.ts)</code>
- **OnError**: throws <code>[ApiError](src/core/api-error.ts)</code>, with `err.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm

**As ApiResult**: `await client.operator.getOperatorSession().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiOperatorSessionResponse, ApiError&gt;</code>, with `result.value` of type <code>[ApiOperatorSessionResponse](src/models/api-operator-session-response.ts)</code>
- **OnError**: `result.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>operatorSignIn(request: Operator.OperatorSignInRequest, options?: RequestOptions): ApiPromise&lt;OperatorSessionState, Operator.OperatorSignInError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Sign in with the operator passphrase.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.operatorSignIn({ body: { passphrase: "some example string" } });
  // TODO: Handle 'response' of type OperatorSessionState
} catch (err) {
  // TODO: Handle 'err' of type Operator.OperatorSignInError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator
  .operatorSignIn({ body: { passphrase: "some example string" } })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type OperatorSessionState
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>[ApiOperatorSessionRequest](src/models/api-operator-session-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.operatorSignIn(request)`

- **OnSuccess**: <code>[OperatorSessionState](src/models/operator-session-state.ts)</code>
- **OnError**: throws <code>[Operator.OperatorSignInError](src/resources/operator.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.operator.operatorSignIn(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;OperatorSessionState, Operator.OperatorSignInError&gt;</code>, with `result.value` of type <code>[OperatorSessionState](src/models/operator-session-state.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>operatorSignOut(options?: RequestOptions): ApiPromise&lt;OperatorSessionState, ApiError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Sign out.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.operator.operatorSignOut();
  // TODO: Handle 'response' of type OperatorSessionState
} catch (err) {
  // TODO: Handle 'err' of type ApiError, where 'err.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.operator.operatorSignOut().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type OperatorSessionState
} else {
  // TODO: Handle 'result', where 'result.payload' is always the Undeclared arm
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.operator.operatorSignOut()`

- **OnSuccess**: <code>[OperatorSessionState](src/models/operator-session-state.ts)</code>
- **OnError**: throws <code>[ApiError](src/core/api-error.ts)</code>, with `err.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm

**As ApiResult**: `await client.operator.operatorSignOut().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;OperatorSessionState, ApiError&gt;</code>, with `result.value` of type <code>[OperatorSessionState](src/models/operator-session-state.ts)</code>
- **OnError**: `result.payload` always the <code>[Undeclared](src/core/api-error.ts)</code> arm, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Webhooks

> Source: [Webhooks](src/resources/webhooks.ts)

<details>
<summary><code>paypalWebhook(request: Webhooks.PaypalWebhookRequest, options?: RequestOptions): ApiPromise&lt;undefined, Webhooks.PaypalWebhookError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Verifies the PayPal signature against the unaltered body, then re-reads provider state. A webhook alone never marks a payment captured or voided.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  await client.webhooks.paypalWebhook({ body: {} });
} catch (err) {
  // TODO: Handle 'err' of type Webhooks.PaypalWebhookError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.webhooks.paypalWebhook({ body: {} }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: The call succeeded and resolves to no body
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>body</code> | <code>Record&lt;string, unknown&gt;</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.webhooks.paypalWebhook(request)`

- **OnSuccess**: <code>undefined</code>
- **OnError**: throws <code>[Webhooks.PaypalWebhookError](src/resources/webhooks.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.webhooks.paypalWebhook(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;undefined, Webhooks.PaypalWebhookError&gt;</code>, with `result.value` of type <code>undefined</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Gear

> Source: [Gear](src/resources/gear.ts)

<details>
<summary><code>findEvGear(request?: Gear.FindEvGearRequest, options?: RequestOptions): ApiPromise&lt;ApiGearResponse, Gear.FindEvGearError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Read-only product search through Channel3. Returns merchant links; nothing is bought. `enabled` is false when no Channel3 key is configured on the server.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.gear.findEvGear({
    q: "J1772 to Tesla adapter",
    maxPriceCents: 6000,
    limit: 6,
  });
  // TODO: Handle 'response' of type ApiGearResponse
} catch (err) {
  // TODO: Handle 'err' of type Gear.FindEvGearError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.gear
  .findEvGear({ q: "J1772 to Tesla adapter", maxPriceCents: 6000, limit: 6 })
  .asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ApiGearResponse
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>q?</code> | <code>string</code> | Search text; defaults to common EV charging accessories. |
| <code>maxPriceCents?</code> | <code>number</code> | Price cap in US cents. |
| <code>limit?</code> | <code>number</code> | Number of results (1-12). |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.gear.findEvGear(request)`

- **OnSuccess**: <code>[ApiGearResponse](src/models/api-gear-response.ts)</code>
- **OnError**: throws <code>[Gear.FindEvGearError](src/resources/gear.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.gear.findEvGear(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ApiGearResponse, Gear.FindEvGearError&gt;</code>, with `result.value` of type <code>[ApiGearResponse](src/models/api-gear-response.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[GridWindowFlexPayApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

