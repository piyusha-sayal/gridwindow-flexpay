import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const Preference = {
  LowestCost: "lowest_cost",
  EarlyFinish: "early_finish",
  Gentle: "gentle",
} as const;
export type Preference = (typeof Preference)[keyof typeof Preference] | (string & {});

export const preferenceSchema: EnumSchema<Preference> = s.enumOf<Preference>(Preference);
