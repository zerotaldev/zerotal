import { createFacade } from "@zerotal/core";
import type { SettingsManager } from "../SettingsManager.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    settings: SettingsManager;
  }
}

/**
 * The `settings` binding: every declared setting by its string key. Generic code
 * — a screen that lists them all, a command — uses this; app code reads through
 * the typed group `defineSettings()` returns.
 */
export const Settings = createFacade("settings");
