import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiAssistAskRequest = {
  reservationId: string;
  question: string;
};

const apiAssistAskRequestProperties: s.Shape<ApiAssistAskRequest> = {
  reservationId: s.string(),
  question: s.string(),
};

export const apiAssistAskRequestInternalSchema: Schema<ApiAssistAskRequest> = s.object<ApiAssistAskRequest>(
  apiAssistAskRequestProperties,
);

export const apiAssistAskRequestSchema: Schema<ApiAssistAskRequest> = s.lazySchema(() =>
  s.object<ApiAssistAskRequest>({
    ...apiAssistAskRequestProperties,
    reservationId: s.string().check(s.maxLength(64)),
    question: s.string().check(s.minLength(1), s.maxLength(500)),
  }),
);
