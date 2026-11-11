import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { providerModeSchema, type ProviderMode } from "./provider-mode.js";

export type ApiOffersAcceptResponse = {
  reservationId: string;
  /** PayPal Sandbox checkout URL, or the in-app MOCK approval page */
  approveUrl: string;
  providerMode: ProviderMode;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const apiOffersAcceptResponseSchema: Schema<ApiOffersAcceptResponse> =
  s.object<ApiOffersAcceptResponse>(
    {
      reservationId: s.string(),
      approveUrl: s.string(),
      providerMode: providerModeSchema,
    },
    { additionalProperties: s.json() },
  );
