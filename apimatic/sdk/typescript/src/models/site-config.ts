import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { aiSchema, type Ai } from "./ai.js";
import { providerModeSchema, type ProviderMode } from "./provider-mode.js";
import { stationSchema, type Station } from "./station.js";

export type SiteConfig = {
  providerMode?: ProviderMode;
  station?: Station;
  ai?: Ai;
  defaultNightOf?: string;
  defaultPlugInLocal?: string;
  defaultDepartLocal?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const siteConfigProperties: s.Shape<SiteConfig> = {
  providerMode: s.optional(s.lazy(() => providerModeSchema)),
  station: s.optional(s.lazy(() => stationSchema)),
  ai: s.optional(s.lazy(() => aiSchema)),
  defaultNightOf: s.optional(s.dateOnly()),
  defaultPlugInLocal: s.optional(s.string()),
  defaultDepartLocal: s.optional(s.string()),
};

export const siteConfigInternalSchema: Schema<SiteConfig> = s.object<SiteConfig>(siteConfigProperties, {
  additionalProperties: s.json(),
});

export const siteConfigSchema: Schema<SiteConfig> = s.lazySchema(() =>
  s.object<SiteConfig>(
    {
      ...siteConfigProperties,
      defaultPlugInLocal: s.optional(s.string().check(s.pattern("^\\d{2}:\\d{2}$"))),
      defaultDepartLocal: s.optional(s.string().check(s.pattern("^\\d{2}:\\d{2}$"))),
    },
    { additionalProperties: s.json() },
  ),
);
