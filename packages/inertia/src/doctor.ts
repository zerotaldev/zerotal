/**
 * The `zt doctor` check for the framework packages an Inertia app needs.
 *
 * React, Vue, their Inertia adapters and the `.vue` compiler are optional peers, so
 * nothing installs them for the app. The ones it needs follow from what it does: an
 * app with `.vue` files needs the compiler to build at all, and an app that turns on
 * `inertia.ssr` needs its framework's server renderer. Either one missing is found
 * here, before a build or a first request trips over it.
 *
 * @module
 */
import type { Application, DoctorCheck, DoctorCheckResult } from "@zerotal/core";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import {
  _loadInertiaReact,
  _loadInertiaVue,
  _loadReact,
  _loadReactDomServer,
  _loadVue,
  _loadVueCompiler,
  _loadVueServerRenderer,
} from "./peers.ts";
import { _hasVueSources } from "./vuePlugin.ts";

/** Whether the app's config turns on server rendering. */
function _ssrOn(app: Application): boolean {
  try {
    const config = app.container.makeSync("config") as { get(key: string): unknown };
    return config.get("inertia.ssr") === true;
  } catch {
    return false;
  }
}

/**
 * Build the check for the app rooted at `cwd`.
 *
 * @param cwd - The app's root directory. Defaults to the working directory at run time.
 * @internal
 */
export function _inertiaPeersCheck(cwd?: string): DoctorCheck {
  return {
    id: "inertia-peers",
    label: "Inertia framework packages",
    async run(app: Application): Promise<DoctorCheckResult> {
      const root = cwd ?? process.cwd();
      const ssr = _ssrOn(app);
      const vue = await _hasVueSources(root);

      const loaders: (() => Promise<unknown>)[] = [];
      if (vue) loaders.push(_loadVueCompiler);
      if (ssr && vue) loaders.push(_loadVue, _loadVueServerRenderer, _loadInertiaVue);
      if (ssr && !vue) loaders.push(_loadReact, _loadReactDomServer, _loadInertiaReact);
      if (loaders.length === 0) {
        return { status: "ok", message: "server rendering is off, and there is no .vue file." };
      }

      const missing: OptionalPeerMissingError[] = [];
      for (const load of loaders) {
        try {
          await load();
        } catch (error) {
          if (!(error instanceof OptionalPeerMissingError)) throw error;
          missing.push(error);
        }
      }

      const what = `${ssr ? "Server-rendered " : ""}${vue ? "Vue" : "React"} pages`;
      if (missing.length === 0) {
        return { status: "ok", message: `${what}: every package they need is installed.` };
      }
      const names = [...new Set(missing.map((error) => error.missing.peer))];
      const list = names.map((name) => `"${name}"`).join(", ");
      return {
        status: "fail",
        message: `${what} need ${list}, which ${names.length === 1 ? "is" : "are"} not installed.`,
        fix: `bun add ${names.join(" ")}`,
      };
    },
  };
}
