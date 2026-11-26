/**
 * Vue Single-File Component (`.vue`) support for Inertia's Bun.build() pipeline.
 *
 * Bun's bundler has no native `.vue` loader, so this module compiles SFCs with
 * `@vue/compiler-sfc` inside a Bun plugin. The compiler is an optional peer, loaded
 * through `peers.ts`, so a React app that never installs it is unaffected.
 *
 * A missing compiler is only "not a Vue app" when there is nothing to compile. When
 * `resources/` holds a `.vue` file, the build cannot succeed without it, and saying
 * so beats the bundler's "no loader is configured for .vue files".
 */
import { existsSync } from "node:fs";
import type { BunPlugin } from "bun";
import { Glob } from "bun";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import { _loadVueCompiler } from "./peers.ts";
import type { SfcCompiler } from "./peers.ts";

/** Whether `error` says the `.vue` compiler is not installed. */
function _isCompilerMissing(error: unknown): boolean {
  return error instanceof OptionalPeerMissingError && error.missing.peer === "@vue/compiler-sfc";
}

/**
 * Whether the app has a `.vue` file under `resources/`, which is where its pages,
 * layouts and components live.
 *
 * @param cwd - The app's root directory.
 * @internal
 */
export async function _hasVueSources(cwd: string): Promise<boolean> {
  const dir = `${cwd}/resources`;
  if (!existsSync(dir)) return false;
  for await (const _ of new Glob("**/*.vue").scan({ cwd: dir, onlyFiles: true })) return true;
  return false;
}

/**
 * Return a Bun plugin that compiles `.vue` files, or `[]` for an app without Vue.
 *
 * @param cwd - The app's root directory.
 * @returns The plugin when `@vue/compiler-sfc` is installed; `[]` when it is not and
 *   `resources/` holds no `.vue` file.
 * @throws {@link OptionalPeerMissingError} When `resources/` holds a `.vue` file and
 *   `@vue/compiler-sfc` is not installed.
 * @internal Build plumbing for `inertia:build`; apps do not call it.
 */
export async function detectVuePlugin(cwd: string): Promise<BunPlugin[]> {
  try {
    return [vueSfcPlugin(await _loadVueCompiler())];
  } catch (error) {
    if (_isCompilerMissing(error) && !(await _hasVueSources(cwd))) return [];
    throw error;
  }
}

let _runtimeLoader: Promise<void> | null = null;

/** Register the compiler as a runtime loader, once per process. */
function _registerRuntimeLoader(load: () => Promise<SfcCompiler>): Promise<void> {
  _runtimeLoader ??= load().then(
    (sfc) => {
      Bun.plugin(vueSfcPlugin(sfc));
    },
    (error: unknown) => {
      // Let a later call try again: the app may install the compiler and reload.
      _runtimeLoader = null;
      throw error;
    },
  );
  return _runtimeLoader;
}

/**
 * Register the `.vue` compiler as a *runtime* Bun loader so server-side
 * `import('*.vue')` works (used by SSR and `Inertia.stream()`). Build-time
 * plugins only affect `Bun.build`, not the runtime module loader.
 *
 * Called at boot. Without `@vue/compiler-sfc` it does nothing, unless `required` is
 * set and the app has `.vue` files: a client-rendered Vue app never compiles a `.vue`
 * file on the server, so it can run without the compiler, and a server-rendered one
 * cannot. Safe to call more than once — only the first registration happens.
 *
 * @param cwd - The app's root directory.
 * @param options - `required: true` when the app server-renders (`inertia.ssr`).
 * @throws {@link OptionalPeerMissingError} When `required` is set, `resources/` holds
 *   a `.vue` file, and `@vue/compiler-sfc` is not installed.
 */
export async function registerVueRuntimeLoader(
  cwd: string,
  options: { required?: boolean | undefined } = {},
): Promise<void> {
  try {
    await _registerRuntimeLoader(_loadVueCompiler);
  } catch (error) {
    if (_isCompilerMissing(error) && !(options.required === true && (await _hasVueSources(cwd))))
      return;
    throw error;
  }
}

/**
 * Make sure a `.vue` file can be imported on the server, for a page about to render
 * from one.
 *
 * @throws {@link OptionalPeerMissingError} When `@vue/compiler-sfc` is not installed.
 * @internal
 */
export function _requireVueRuntimeLoader(): Promise<void> {
  return _registerRuntimeLoader(_loadVueCompiler);
}

/**
 * The message for the `.vue` compiler's errors, each with its place in the file as `(line:column)`.
 *
 * Bun gives an error thrown from a plugin no position of its own, so a build reported
 * `index.vue:0:0`, and the compiler's errors said only "Element is missing end tag." with no line
 * at all. The place goes at the end of the first line, where the script compiler already puts
 * its own (`Unexpected token (12:15)`), and where the build log reads it from.
 *
 * @param errors - The compiler's errors: `CompilerError`s with a `loc`, or plain errors.
 * @param lineOffset - Lines before the compiled source's first, for a block compiled alone.
 * @internal Exported for tests.
 */
export function _vueErrorMessage(what: string, errors: readonly unknown[], lineOffset = 0): string {
  const lines = errors.map((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const start = (error as { loc?: { start?: { line?: unknown; column?: unknown } } } | null)?.loc
      ?.start;
    if (typeof start?.line !== "number" || typeof start.column !== "number") return message;
    return `${message} (${start.line + lineOffset}:${start.column})`;
  });
  return `[vue] ${what}: ${lines.join("\n")}`;
}

function vueSfcPlugin(sfc: SfcCompiler): BunPlugin {
  return {
    name: "zerotal-vue-sfc",
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async (args) => {
        const source = await Bun.file(args.path).text();
        const { descriptor, errors } = sfc.parse(source, { filename: args.path });
        if (errors.length > 0) throw new Error(_vueErrorMessage("Failed to parse", errors));

        // Stable per-file id used for scoped-style hashing (data-v-<id>).
        const id = Bun.hash(args.path).toString(16).slice(0, 8);
        const scopeId = `data-v-${id}`;
        const hasScoped = descriptor.styles.some((s) => s.scoped === true);
        const isSetup = Boolean(descriptor.scriptSetup);

        // The component is built up as `__sfc_main__` and exported last, so the render
        // function and the scope id can be attached to it first. `genDefaultAs` asks the
        // compiler for exactly that, in both script forms. (Before it, `<script setup>`
        // exported its component directly and the scope id was attached to nothing, so
        // scoped styles matched no element; and a `<script lang="ts">` was rewritten by
        // a parser that did not read TypeScript.)
        let code = "const __sfc_main__ = {};";
        let bindings: unknown;
        if (isSetup || descriptor.script) {
          const script = sfc.compileScript(descriptor, {
            id,
            genDefaultAs: "__sfc_main__",
            // `<script setup>` compiles its template into setup() itself.
            inlineTemplate: isSetup,
          });
          code = script.content;
          bindings = script.bindings;
        }

        if (!isSetup && descriptor.template) {
          const tpl = sfc.compileTemplate({
            source: descriptor.template.content,
            filename: args.path,
            id,
            scoped: hasScoped,
            slotted: descriptor.slotted,
            compilerOptions: { bindingMetadata: bindings },
          });
          if (tpl.errors.length > 0) {
            // The template is compiled on its own, so its errors count lines from the
            // `<template>` tag; the file's line is that many past the tag's.
            const offset = (descriptor.template.loc?.start.line ?? 1) - 1;
            throw new Error(_vueErrorMessage("Template error", tpl.errors, offset));
          }
          code += `\n${tpl.code}\n__sfc_main__.render = render;`;
        }

        if (hasScoped) code += `\n__sfc_main__.__scopeId = ${JSON.stringify(scopeId)};`;

        // Compile and runtime-inject any <style> blocks (Tailwind apps have none).
        if (descriptor.styles.length > 0) {
          let css = "";
          for (const style of descriptor.styles) {
            css += sfc.compileStyle({
              source: style.content,
              filename: args.path,
              id: scopeId,
              scoped: style.scoped === true,
            }).code;
          }
          code += `\n(function(){if(typeof document!=='undefined'){var s=document.createElement('style');s.setAttribute('data-vue-id',${JSON.stringify(id)});s.textContent=${JSON.stringify(css)};document.head.appendChild(s);}})();`;
        }

        code += "\nexport default __sfc_main__;";
        return { contents: code, loader: "ts" };
      });
    },
  };
}
