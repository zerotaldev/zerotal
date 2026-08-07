// Synth (key "cbn") for Carbon datetimes: serializes to an ISO 8601 string and
// hydrates back to a Carbon. Registered as a side effect of importing this module.
import { Carbon } from "@zerotal/core/carbon";
import { registerSynth } from "./index.ts";

registerSynth({
  key: "cbn",

  match(value): value is Carbon {
    return value instanceof Carbon;
  },

  dehydrate(value: Carbon, _meta) {
    return value.toISOString();
  },

  hydrate(data, _meta) {
    return new Carbon(data as string);
  },
});
