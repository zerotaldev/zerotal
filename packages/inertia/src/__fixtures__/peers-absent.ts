/**
 * Every optional peer loader, run where none of the peers is installed.
 *
 * `peers.test.ts` bundles this file with the peers left external and runs the output
 * from a directory with no `node_modules` above it, so every import fails the way it
 * does in an app that never installed the package. Prints one JSON line: for each
 * loader, what it threw.
 */
import {
  _loadInertiaReact,
  _loadInertiaVue,
  _loadReact,
  _loadReactDomServer,
  _loadVue,
  _loadVueCompiler,
  _loadVueServerRenderer,
} from "../peers.ts";
import type { Application } from "@zerotal/core";
import { _inertiaPeersCheck } from "../doctor.ts";
import { detectVuePlugin, registerVueRuntimeLoader } from "../vuePlugin.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const loaders = {
  react: _loadReact,
  "react-dom/server": _loadReactDomServer,
  "@inertiajs/react": _loadInertiaReact,
  vue: _loadVue,
  "vue/server-renderer": _loadVueServerRenderer,
  "@inertiajs/vue3": _loadInertiaVue,
  "@vue/compiler-sfc": _loadVueCompiler,
};

const results: Record<string, unknown> = {};
for (const [name, load] of Object.entries(loaders)) {
  try {
    await load();
    results[name] = "loaded";
  } catch (error) {
    const e = error as { name?: string; code?: string; missing?: unknown; message?: string };
    results[name] = { name: e.name, code: e.code, missing: e.missing, message: e.message };
  }
}

/** What a call threw, as `"ok"` or the error's code. */
async function outcome(call: () => Promise<unknown>): Promise<unknown> {
  try {
    const value = await call();
    return Array.isArray(value) ? value.length : "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

// A React app: no `.vue` file anywhere. (This directory has no `resources/` at all.)
const reactApp = process.cwd();
// A Vue app that has not installed the compiler.
const vueApp = join(reactApp, "vue-app");
mkdirSync(join(vueApp, "resources", "pages"), { recursive: true });
writeFileSync(join(vueApp, "resources", "pages", "Home.vue"), "<template><p>hi</p></template>\n");

const boot = {
  reactSsr: await outcome(() => registerVueRuntimeLoader(reactApp, { required: true })),
  vueClientOnly: await outcome(() => registerVueRuntimeLoader(vueApp)),
  vueSsr: await outcome(() => registerVueRuntimeLoader(vueApp, { required: true })),
};
const build = {
  react: await outcome(() => detectVuePlugin(reactApp)),
  vue: await outcome(() => detectVuePlugin(vueApp)),
};

/** A booted app, as far as the doctor check reads one. */
const appWith = (ssr: boolean) =>
  ({
    container: { makeSync: () => ({ get: (key: string) => key === "inertia.ssr" && ssr }) },
  }) as unknown as Application;
const doctor = {
  reactClientOnly: await _inertiaPeersCheck(reactApp).run(appWith(false)),
  reactSsr: await _inertiaPeersCheck(reactApp).run(appWith(true)),
  vueClientOnly: await _inertiaPeersCheck(vueApp).run(appWith(false)),
  vueSsr: await _inertiaPeersCheck(vueApp).run(appWith(true)),
};

console.log(JSON.stringify({ results, boot, build, doctor }));
