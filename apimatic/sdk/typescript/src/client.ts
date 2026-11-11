import { buildAuthSchemes, type AuthSchemes } from "./auth-schemes.js";
import type { ClientOptions } from "./client-options.js";
import { buildCoreClientOptions } from "./core/client-options.js";
import { RawClient } from "./core/raw-client.js";
import * as host from "./core/runtime-environment.js";
import * as s from "./core/validation/index.js";
import { AiApi } from "./resources/ai-api.js";
import { Checkout } from "./resources/checkout.js";
import { Offers } from "./resources/offers.js";
import { Operator } from "./resources/operator.js";
import { Reservations } from "./resources/reservations.js";
import { Site } from "./resources/site.js";
import { Webhooks } from "./resources/webhooks.js";
import { buildServers, type Servers } from "./servers.js";

/**
 * The public driver API behind GridWindow FlexPay, plus the operator endpoints.
 *
 * **Flow.** A driver (or an AI agent acting for one, see `docs/MCP.md`) reads the site, requests
 * priced offers, optionally asks the deal agent for a pick, then accepts one exact offer. Accepting
 * creates a PayPal Orders v2 **AUTHORIZE** order and returns an `approveUrl`; only the human buyer
 * can approve it in PayPal. The server then authorizes, commits the charging slots, and later
 * captures for delivered energy or voids. The client never sets a price and never moves money.
 *
 * **Sessions.** Driver identity is a signed `gw_drv` cookie created on the first quote. Operator
 * endpoints need the `gw_op` cookie from `POST /api/operator/session`. Mutating requests must come
 * from an allowed origin (`Origin` header).
 *
 * **Money.** All amounts are integer US cents. Payments are PayPal **Sandbox** (test money) or a
 * labelled MOCK provider.
 */
export class GridWindowFlexPayApiClient {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;
  readonly #auth: AuthSchemes;
  #site?: Site;
  #offers?: Offers;
  #aiApi?: AiApi;
  #checkout?: Checkout;
  #reservations?: Reservations;
  #operator?: Operator;
  #webhooks?: Webhooks;

  constructor(options: ClientOptions = {}) {
    this.#rawClient = new RawClient({
      ...buildCoreClientOptions(options, "GRID_WINDOW_FLEX_PAY_API_CLIENT_LOG"),
      defaultHeaders: [
        { name: "User-Agent", value: "GridWindowFlexPayApiClient/1.0.0 TypeScript", schema: s.string() },
        { name: "X-APIMatic-Lang", value: "TypeScript", schema: s.string() },
        { name: "X-APIMatic-Package-Version", value: "1.0.0", schema: s.string() },
        { name: "X-APIMatic-Gen-Version", value: "4.0.0", schema: s.string() },
        { name: "X-APIMatic-OS", value: host.operatingSystem(), schema: s.optional(s.string()) },
        { name: "X-APIMatic-Runtime", value: host.runtimeDescription(), schema: s.optional(s.string()) },
      ],
      defaultQuery: [],
      defaultPathParams: [],
    });

    this.#servers = buildServers(options);

    this.#auth = buildAuthSchemes(options);
  }

  /**
   * Station, ports and payment mode
   */
  get site(): Site {
    return (this.#site ??= new Site(this.#rawClient, this.#servers));
  }

  /**
   * Priced charging offers with exact terms
   */
  get offers(): Offers {
    return (this.#offers ??= new Offers(this.#rawClient, this.#servers));
  }

  /**
   * Plain-language parsing, explanations and the deal agent (never sets prices or moves money)
   */
  get aiApi(): AiApi {
    return (this.#aiApi ??= new AiApi(this.#rawClient, this.#servers));
  }

  /**
   * Accepting an offer and the PayPal approval round trip
   */
  get checkout(): Checkout {
    return (this.#checkout ??= new Checkout(this.#rawClient, this.#servers));
  }

  /**
   * Reservation, payment state and provider proofs
   */
  get reservations(): Reservations {
    return (this.#reservations ??= new Reservations(this.#rawClient, this.#servers));
  }

  /**
   * Operator session and night dashboard
   */
  get operator(): Operator {
    return (this.#operator ??= new Operator(this.#rawClient, this.#servers, this.#auth));
  }

  /**
   * PayPal Sandbox webhooks
   */
  get webhooks(): Webhooks {
    return (this.#webhooks ??= new Webhooks(this.#rawClient, this.#servers));
  }
}
