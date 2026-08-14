/**
 * Dev-only build and live-reload tooling (the `@zerotal/core/dev` subpath):
 * the build hook, the reload middleware that injects the HMR client snippet,
 * and the CSS/JS bundling helpers. Owns `Bun.build`, so it is kept off the
 * kernel barrel and is inactive outside the dev worker.
 *
 * @internal — framework dev-server wiring; not part of the app-facing API.
 *
 * @packageDocumentation
 */
export { registerDevBuildHook } from "./DevBuildHook.ts";
// The dev-process registry and its runners. The definition *types* are on the
// main barrel (a provider's `devProcesses()` signature needs to name them);
// everything that runs them is here, with the rest of the dev-server wiring.
export { collectDevProcesses } from "./DevProcess.ts";
export { DevSupervisor } from "./DevSupervisor.ts";
export type {
  DevChild,
  DevSpawnFn,
  DevProcessState,
  DevProcessStatus,
  DevSupervisorOptions,
} from "./DevSupervisor.ts";
export { createDeck, StreamDeck, TabsDeck } from "./DevDeck.ts";
export type { Deck, DeckOptions } from "./DevDeck.ts";
export type { BuildHookFn, BuildResult } from "./DevBuildHook.ts";
export { DevReloadMiddleware, registerDevHtmlSnippet } from "./DevReloadMiddleware.ts";
export type { DevHtmlSnippet } from "./DevReloadMiddleware.ts";
export { DEV_RELOAD_CLIENT } from "./reloadClient.ts";
export { detectCssPlugins, buildCssBundle, buildJsBundle } from "./CssPlugins.ts";
export type { AssetBuildConfig } from "./CssPlugins.ts";
export { pruneBuildOutput } from "./BuildOutput.ts";
// Lets a view provider skip its own boot-time build when the orchestrator is
// already driving builds through the hook above.
export { isDevOrchestrated } from "../support/env.ts";
// `AppAssetsConfig` (the app-level assets config shape) lives on @zerotal/core/config.
