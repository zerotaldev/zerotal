import { BunImageDriver } from "./conversions/BunImageDriver.ts";
import { mediaDefaults, type MediaConfigShape } from "./config.ts";
import type { ImageDriver } from "./conversions/ImageDriver.ts";

/** The resolved config and image driver the package operates with. */
export interface MediaState {
  config: MediaConfigShape;
  driver: ImageDriver;
}

let _state: MediaState | null = null;

/**
 * The active media state.
 *
 * `MediaProvider` installs the real one at boot. Falling back to defaults rather
 * than throwing keeps the model usable in a unit test that never builds an
 * application — which is most tests that touch a model.
 */
export function mediaState(): MediaState {
  if (_state === null) {
    const config = mediaDefaults();
    _state = { config, driver: new BunImageDriver() };
  }
  return _state;
}

/** Install the resolved state. Called by `MediaProvider`. */
export function setMediaState(state: MediaState): void {
  _state = state;
}

/** Drop the state so the next read rebuilds it from defaults. For tests. */
export function resetMediaState(): void {
  _state = null;
}
