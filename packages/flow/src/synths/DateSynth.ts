// Synth (key "dt") for plain JS Dates: serializes to an ISO string and hydrates
// back to a Date. Because Carbon extends Date, this synth deliberately excludes
// Carbon instances so they route to CarbonSynth instead. Registered as a side
// effect of importing this module.
import { Carbon } from "@zerotal/core/carbon";
import { registerSynth } from "./index.ts";

registerSynth({
  key: "dt",

  match(value): value is Date {
    // Plain Date — Carbon is a subclass of Date so check it first via CarbonSynth;
    // this synth only fires for non-Carbon Dates.
    return value instanceof Date && !(value instanceof Carbon);
  },

  dehydrate(value: Date, _meta) {
    return value.toISOString();
  },

  hydrate(data, _meta) {
    return new Date(data as string);
  },
});
