import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { reservationViewSchema, type ReservationView } from "./reservation-view.js";

export type ApiReservationsResponse = {
  reservations?: ReservationView[];
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const apiReservationsResponseSchema: Schema<ApiReservationsResponse> =
  s.object<ApiReservationsResponse>(
    {
      reservations: s.optional(s.array(s.lazy(() => reservationViewSchema))),
    },
    { additionalProperties: s.json() },
  );
