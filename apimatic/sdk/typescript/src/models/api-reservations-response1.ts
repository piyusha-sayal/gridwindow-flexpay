import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { reservationViewSchema, type ReservationView } from "./reservation-view.js";

export type ApiReservationsResponse1 = {
  reservation?: ReservationView;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const apiReservationsResponse1Schema: Schema<ApiReservationsResponse1> =
  s.object<ApiReservationsResponse1>(
    {
      reservation: s.optional(s.lazy(() => reservationViewSchema)),
    },
    { additionalProperties: s.json() },
  );
