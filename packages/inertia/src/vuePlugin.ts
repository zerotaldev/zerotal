/**
 * Vue Single-File Component (`.vue`) support for Inertia's Bun.build() pipeline.
 *
 * Bun's bundler has no native `.vue` loader, so this module compiles SFCs with
 * `@vue/compiler-sfc` inside a Bun plugin. The compiler is resolved from the
 * *app's* node_modules (not @zerotal/inertia's), exactly like the Tailwind CSS
 * plugin — so React apps that never install it are completely unaffected.
 *
 * `detectVuePlugin()` returns an empty array when `@vue/compiler-sfc` is not
 * installed, making `.vue` support fully opt-in.
 */
import type { BunPlugin } from "bun";

// Minimal structural type for the slice of @vue/compiler-sfc we use. Imported
// dynamically from the app's install, so we avoid a hard dependency here.
interface SfcCompiler {
  parse(
    source: string,
    options: { filename: string },
  ): { descriptor: SfcDescriptor; errors: unknown[] };
  compileScript(
    descriptor: SfcDescriptor,
    options: Record<string, unknown>,
  ): { content: string; bindings?: unknown };
  compileTemplate(options: Record<string, unknown>): { code: string; errors: unknown[] };
  compileStyle(options: Record<string, unknown>): { code: string };
  rewriteDefault(input: string, as: string): string;
}

interface SfcDescriptor {
  scriptSetup: unknown | null;
  script: { content: string } | null;
  template: { content: string } | null;
  styles: { content: string; scoped: boolean }[];
  slotted: boolean;
}

/**
 * Resolve `@vue/compiler-sfc` from `cwd` and return a Bun plugin that compiles
 * `.vue` files. Returns `[]` when the compiler is not installed.
 *
 * @internal Build plumbing for `inertia:build`; apps do not call it.
 */
export async function detectVuePlugin(cwd: string): Promise<BunPlugin[]> {
  let compilerPath: string;
  try {
    compilerPath = Bun.resolveSync("@vue/compiler-sfc", cwd);
  } catch {
    return [];
  }
  const sfc = (await import(compilerPath)) as unknown as SfcCompiler;
  return [vueSfcPlugin(sfc)];
}

let _runtimeLoaderRegistered = false;

/**
 * Register the `.vue` compiler as a *runtime* Bun loader so server-side
 * `import('*.vue')` works (used by SSR and `Inertia.stream()`). Build-time
 * plugins only affect `Bun.build`, not the runtime module loader.
 *
 * No-op (and harmless) when `@vue/compiler-sfc` is not installed, and safe to
 * call more than once — only the first call registers.
 */
export async function registerVueRuntimeLoader(cwd: string): Promise<void> {
  if (_runtimeLoaderRegistered) return;
  const plugins = await detectVuePlugin(cwd);
  if (plugins.length === 0) return;
  for (const plugin of plugins) Bun.plugin(plugin);
  _runtimeLoaderRegistered = true;
}

function vueSfcPlugin(sfc: SfcCompiler): BunPlugin {
  return {
    name: "zerotal-vue-sfc",
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async (args) => {
        const source = await Bun.file(args.path).text();
        const { descriptor, errors } = sfc.parse(source, { filename: args.path });
        if (errors.length > 0) {
          throw new Error(`[Zerotal Vue] Failed to parse ${args.path}:\n${errors.join("\n")}`);
        }

        // Stable per-file id used for scoped-style hashing (data-v-<id>).
        const id = Bun.hash(args.path).toString(16).slice(0, 8);
        const hasScoped = descriptor.styles.some((s) => s.scoped);

        let code: string;

        if (descriptor.scriptSetup) {
          // `<script setup>`: inline the template render fn straight into setup().
          const script = sfc.compileScript(descriptor, {
            id,
            inlineTemplate: true,
            templateOptions: hasScoped ? { id, scoped: true } : { id },
          });
          code = script.content; // already contains `export default ...`
        } else {
          // Plain `<script>` (or none) + separate template compile.
          const scriptContent = descriptor.script
            ? sfc.compileScript(descriptor, { id }).content
            : "export default {}";
          code = sfc.rewriteDefault(scriptContent, "__sfc_main__");

          if (descriptor.template) {
            const tpl = sfc.compileTemplate({
              source: descriptor.template.content,
              filename: args.path,
              id,
              scoped: hasScoped,
              slotted: descriptor.slotted,
              compilerOptions: { bindingMetadata: sfc.compileScript(descriptor, { id }).bindings },
            });
            if (tpl.errors.length > 0) {
              throw new Error(
                `[Zerotal Vue] Template error in ${args.path}:\n${tpl.errors.join("\n")}`,
              );
            }
            code += `\n${tpl.code}\n__sfc_main__.render = render;`;
          }
          code += "\nexport default __sfc_main__;";
        }

        if (hasScoped) {
          code += `\nif (typeof __sfc_main__ !== 'undefined') __sfc_main__.__scopeId = ${JSON.stringify(`data-v-${id}`)};`;
        }

        // Compile and runtime-inject any <style> blocks (Tailwind apps have none).
        if (descriptor.styles.length > 0) {
          let css = "";
          for (const style of descriptor.styles) {
            css += sfc.compileStyle({
              source: style.content,
              filename: args.path,
              id: `data-v-${id}`,
              scoped: style.scoped,
            }).code;
          }
          code += `\n(function(){if(typeof document!=='undefined'){var s=document.createElement('style');s.setAttribute('data-vue-id',${JSON.stringify(id)});s.textContent=${JSON.stringify(css)};document.head.appendChild(s);}})();`;
        }

        return { contents: code, loader: "ts" };
      });
    },
  };
}
