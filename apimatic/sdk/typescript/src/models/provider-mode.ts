import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const ProviderMode = {
  PaypalSandbox: "PAYPAL_SANDBOX",
  Mock: "MOCK",
} as const;
export type ProviderMode = (typeof ProviderMode)[keyof typeof ProviderMode] | (string & {});

export const providerModeSchema: EnumSchema<ProviderMode> = s.enumOf<ProviderMode>(ProviderMode);
