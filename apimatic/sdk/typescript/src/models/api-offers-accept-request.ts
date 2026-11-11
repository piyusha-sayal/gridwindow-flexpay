import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiOffersAcceptRequest = {
  quoteSetId: string;
  offerId: string;
  termsHash: string;
  /**
   * Must be `true` (the driver's explicit consent to these exact terms); any other value is
   * refused.
   */
  consent: boolean;
};

const apiOffersAcceptRequestProperties: s.Shape<ApiOffersAcceptRequest> = {
  quoteSetId: s.string(),
  offerId: s.string(),
  termsHash: s.string(),
  consent: s.boolean(),
};

export const apiOffersAcceptRequestInternalSchema: Schema<ApiOffersAcceptRequest> =
  s.object<ApiOffersAcceptRequest>(apiOffersAcceptRequestProperties);

export const apiOffersAcceptRequestSchema: Schema<ApiOffersAcceptRequest> = s.lazySchema(() =>
  s.object<ApiOffersAcceptRequest>({
    ...apiOffersAcceptRequestProperties,
    quoteSetId: s.string().check(s.maxLength(64)),
    offerId: s.string().check(s.maxLength(128)),
    termsHash: s.string().check(s.pattern("^[0-9a-f]{64}$")),
  }),
);
