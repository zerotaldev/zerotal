// Synth (key "cbi") for CarbonInterval durations: serializes to an ISO 8601
// duration string (e.g. "P1DT2H30M") and hydrates back to a CarbonInterval.
// Registered as a side effect of importing this module.
import { CarbonInterval } from "@zerotal/core/carbon";
import { registerSynth } from "./index.ts";

registerSynth({
  key: "cbi",

  match(value): value is CarbonInterval {
    return value instanceof CarbonInterval;
  },

  dehydrate(value: CarbonInterval, _meta) {
    // Serialise as ISO 8601 duration string: "P1DT2H30M"
    return value.toISO();
  },

  hydrate(data, _meta) {
    return CarbonInterval.fromISO(data as string);
  },
});
