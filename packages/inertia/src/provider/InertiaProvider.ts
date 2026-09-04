import { ServiceProvider, Router, ConfigError, ThrottleMiddleware } from "@zerotal/core";
import { registerTypeGenerator } from "@zerotal/core/commands";
import {
  registerDevBuildHook,
  pruneBuildOutput,
  browserEnvDefines,
  DEV_RELOAD_CLIENT,
} from "@zerotal/core/dev";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { _setHtmlTemplate, _setPagesDir } from "../inertia.ts";
import { DEFAULT_PAGES_DIR } from "../config.ts";
import { setAssetVersion } from "../version.ts";
import { setHistoryEncryptionDefault } from "../historyState.ts";
import { generatePageRegistry } from "../PageRegistry.ts";
import { SsrHandler } from "../SsrHandler.ts";
import { detectCssPlugins } from "../css.ts";
import { detectVuePlugin, registerVueRuntimeLoader } from "../vuePlugin.ts";
import { InertiaMiddleware } from "../middleware/InertiaMiddleware.ts";
import { inertiaRoute } from "../route.ts";
import { InertiaDevtoolsMiddleware } from "../devtools/middleware.ts";
import { devtoolsEnabled, devtoolsSettings } from "../devtools/enabled.ts";
import { registerDevtoolsApi } from "../devtools/api.ts";
import { setMaxEntries } from "../devtools/store.ts";
import { installInertiaObservability } from "../devtools/observability.ts";

export class InertiaProvider extends ServiceProvider {
  static override environments: AppEnvironment[] = ["web", "console", "test"];

  /** Detaches the devtools-panel fan-out. Null when there was nothing to attach. */
  private _stopObservability: (() => void) | null = null;

  override onRegister(): void {
    // Make Router.inertia() available before routes load.
    Router.macro("inertia", inertiaRoute);
  }

  override async onBooting(): Promise<void> {
    this.app.useOnce(InertiaMiddleware);

    // DevTools recorder. Registered before InertiaMiddleware runs its response
    // rewrites so the status it records is the one the client actually sees
    // (302→303, and the version-mismatch 409, both happen in there). Nothing is
    // registered at all when the recorder is off, so a production process has
    // no read API to probe.
    if (devtoolsEnabled()) {
      setMaxEntries(devtoolsSettings().maxEntries);
      this.app.useOnce(InertiaDevtoolsMiddleware);
      registerDevtoolsApi();
    }

    const config = this.app.container.makeSync("config") as ConfigManager;

    // 1. Load HTML template into memory — one disk read at boot, never per-request
    const templatePath = config.get<string>(
      "inertia.htmlTemplate",
      `${process.cwd()}/resources/app.html`,
    );

    try {
      let html = await Bun.file(templatePath).text();

      // In dev-worker mode bake the live-reload client into the cached template.
      // DevReloadMiddleware would inject it for us, but only by buffering the
      // response body — and Inertia.stream() exists precisely to avoid that. The
      // middleware skips any page that already embeds a /__dev/ws client, so the
      // two never double-inject.
      if (process.argv.includes("--dev-worker")) {
        html = html.replace("</body>", DEV_RELOAD_CLIENT + "\n</body>");
      }

      _setHtmlTemplate(html);
    } catch {
      // Template not found — warn in development, throw in production
      const isDev = config.get<string>("app.env", "production") !== "production";
      if (!isDev) {
        throw new ConfigError(
          `[Zerotal Inertia] HTML template not found at: ${templatePath}\n` +
            `Create the template there, then run \`bun zt inertia:build\` to generate the page registry ` +
            `(scaffold new pages with \`bun zt make:page\`).`,
        );
      }
      console.warn(
        `[Zerotal Inertia] HTML template not found at: ${templatePath}. ` +
          `Using empty fallback for development.`,
      );
      _setHtmlTemplate(_defaultHtmlTemplate());
    }

    // 2. Set asset version (used for 409 cache-busting)
    const version = config.get<string>("inertia.version", "1");
    setAssetVersion(version);

    // 2a. Resolve the pages directory (used by SSR / inertiaStream to load
    // components from disk). Configurable via `inertia.pagesDir`.
    const pagesDir = config.get<string>("inertia.pagesDir", DEFAULT_PAGES_DIR);
    _setPagesDir(`${process.cwd()}/${pagesDir}`);

    // 2b. History-encryption default (per-request overrides via Inertia.encryptHistory()).
    setHistoryEncryptionDefault(config.get<boolean>("inertia.encryptHistory", false));

    // 2c. Register the .vue runtime loader so server-side `import('*.vue')`
    // works for SSR and Inertia.stream(). No-op unless @vue/compiler-sfc is
    // installed, so React apps are unaffected.
    await registerVueRuntimeLoader(process.cwd());

    // 3. Register the SSR endpoint when the app asks for it — `ssrEndpoint`, not
    // `ssr`. Rendering happens in-process (see `inertia.ts`); this route exists only
    // for a renderer running somewhere else, and turning rendering on should not
    // open a route that renders arbitrary components from POST input.
    if (config.get<boolean>("inertia.ssrEndpoint", false)) {
      // Throttled as well as loopback-gated: rendering a page is real CPU, and this route
      // sits outside every application guard.
      Router.post(
        "/__ssr",
        SsrHandler as unknown as new (...args: unknown[]) => unknown,
        "handle",
        [ThrottleMiddleware.with({ maxAttempts: 120, windowSeconds: 60 })],
      );
    }
  }

  override async onBooted(): Promise<void> {
    // Fan the recorder's entries out to the in-page devtools panel, when one is
    // installed. In `onBooted` rather than `onBooting` because that is the first
    // hook where every provider's bindings exist — `devtools.trace` is registered
    // in DevtoolsProvider's `onBooting`, and provider order is the app's to choose.
    if (devtoolsEnabled()) {
      this._stopObservability = installInertiaObservability(this.app);
    }

    // Register the dev build hook so DevOrchestrator (in @zerotal/core) can
    // trigger a full pages-manifest sync + asset rebuild without @zerotal/core
    // importing @zerotal/inertia (which would create a circular dependency).
    const cwd = process.cwd();

    // Same inversion, for `bun zt route:types`. The page registry and the route
    // map are both "types generated from the file tree" and go stale on the same
    // edits, but only the routes half was wired to the command named for it —
    // so adding a page, running `route:types`, and getting the same `PageName`
    // error back sent people looking at their page name instead of the registry.
    registerTypeGenerator("inertia", (options) => generatePageRegistry(cwd, undefined, options));

    registerDevBuildHook("inertia", async () => {
      await generatePageRegistry(cwd);
      const plugins = [...(await detectCssPlugins(cwd)), ...(await detectVuePlugin(cwd))];
      const outdir = `${cwd}/public/assets`;
      const result = await Bun.build({
        entrypoints: [`${cwd}/resources/js/app.tsx`],
        outdir,
        target: "browser",
        splitting: true,
        minify: false,
        sourcemap: "external",
        // This hook only ever runs under the dev orchestrator, so the build is a
        // development one by construction — which is what turns on the Inertia
        // client hooks the DevTools extension reads.
        define: browserEnvDefines(false),
        ...(plugins.length > 0 ? { plugins } : {}),
      });

      // Each rebuild renames every split chunk, so without this the directory
      // collects a full set of dead chunks per edit for the whole session.
      if (result.success) await pruneBuildOutput(outdir, result.outputs);
      return result;
    });

    // Register CLI commands when in console mode
    const runner = this.app.container.tryMake("commands");
    if (!runner) return;

    (runner as { registerLazy(name: string, thunk: () => Promise<unknown>): void }).registerLazy(
      "inertia:build",
      () =>
        import("../commands/InertiaBuildCommand.ts").then(
          (m) => (m as { InertiaBuildCommand: unknown }).InertiaBuildCommand,
        ),
    );
    (runner as { registerLazy(name: string, thunk: () => Promise<unknown>): void }).registerLazy(
      "make:page",
      () =>
        import("../commands/MakePageCommand.ts").then(
          (m) => (m as { MakePageCommand: unknown }).MakePageCommand,
        ),
    );
  }

  override async onStopping(): Promise<void> {
    // The bridge holds the previous app's sink in a module-local; a suite that
    // boots several apps would otherwise leave one app's recorder writing into
    // the trace store of an app that has already stopped.
    this._stopObservability?.();
    this._stopObservability = null;
  }
}

// Used as fallback when resources/app.html does not exist yet
function _defaultHtmlTemplate(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Zerotal App</title>
  </head>
  <body>
    <!-- @inertia -->
  </body>
</html>`;
}
