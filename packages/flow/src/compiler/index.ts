/**
 * Flow AOT compiler — orchestrates compilation of all registered Pages.
 *
 * Called once by FlowProvider.onBooting() before the server accepts requests.
 * For each page that has a __sourceFile stored on it (set by the file-route
 * resolver), we:
 *   1. Read the source
 *   2. Ask the cache manifest whether the last compile still holds (no parsing)
 *   3. Otherwise: validate, transform() → write to cache and manifest
 *   4. dynamic-import the compiled file
 *   5. Patch PageClass.prototype.render + set __flowCompiled = true
 *
 * Pages that fall back (unsupported JSX patterns, manually-registered routes
 * without __sourceFile) continue using the standard runtime transparently.
 *
 * The parser behind step 3 (`transform.ts`, `constants.ts`, and through them the `typescript`
 * package) is the heaviest thing a Flow app loads, so it is imported only once a page actually
 * misses. A boot where every page is served from the manifest never loads it. Keep those imports
 * literal (`import("./transform.ts")`): `bun zt compile` can only bundle a specifier it can read.
 */

import { pathToFileURL } from "node:url";
import { frameworkLog } from "@zerotal/core/logger";
import type { BlockerReport } from "./transform.ts";
import { FlowValidationError } from "./errors.ts";
import {
  getCachedPath,
  writeCache,
  lookupManifest,
  writeManifest,
  type CompileOutcome,
} from "./cache.ts";
import { staticStringsFingerprint } from "./static-imports.ts";

/** The parser-backed half of the compiler, loaded the first time a page misses the cache. */
async function _loadCompiler() {
  const [transform, constants] = await Promise.all([
    import("./transform.ts"),
    import("./constants.ts"),
  ]);
  return {
    validateFlowFile: transform.validateFlowFile,
    transformFlowFile: transform.transformFlowFile,
    buildBindInjectedRender: transform.buildBindInjectedRender,
    describeBlocker: transform.describeBlocker,
    readImportedStrings: constants.readImportedStrings,
  };
}

/**
 * Set `ZT_FLOW_COMPILE_LOG=1` to have every page that falls back to the runtime
 * renderer say why, with the line to look at. Off by default: falling back is
 * normal and correct for component-heavy pages, so reporting it on every boot
 * would be noise rather than news.
 */
function _explainFallbacks(): boolean {
  return Bun.env["ZT_FLOW_COMPILE_LOG"] === "1";
}

const HELPERS_IMPORT = `import { __esc, __escAttr } from '@zerotal/flow/compiler-helpers';\n\n`;

/**
 * Compile all Component classes that have __sourceFile set.
 *
 * @param appRoot  Absolute path to the app root directory (contains .zerotal/).
 */
export async function compileRegisteredPages(appRoot: string, cspSafe = false): Promise<void> {
  // Import registry lazily to avoid circular deps at module load time.
  const { _getPageEntries } = await import("../registry.ts");
  const entries = _getPageEntries();

  let compiled = 0;
  let cached = 0;
  let skipped = 0;
  let injected = 0;
  // Pages registered from code, with no source file in this app. They render through the
  // runtime by design, and are left out of the fallback warning: it is addressed to the
  // authors of the app's own pages.
  let external = 0;

  const start = Date.now();

  for (const [, entry] of entries) {
    const PageClass = entry.PageClass as unknown as { new (): unknown } & {
      prototype: { render?: (...a: unknown[]) => unknown };
      __flowCompiled?: boolean;
      __sourceFile?: string;
    };

    const sourceFile = PageClass.__sourceFile;
    if (!sourceFile) {
      skipped++;
      external++;
      continue;
    }

    // Already compiled in this process (e.g. shared base class registered twice)
    if (PageClass.__flowCompiled) {
      cached++;
      continue;
    }

    const source = await Bun.file(sourceFile).text();

    /** A failure that leaves this page on the runtime renderer, or stops the boot under CSP. */
    const fallBack = (err: unknown): void => {
      // In CSP-safe mode there is no safe runtime fallback — surface the error so
      // the server refuses to boot and the developer fixes the page.
      if (cspSafe) throw err;
      // Otherwise a non-fatal compile failure falls back to the runtime renderer.
      // Compiler errors already carry a `[Flow]` tag; strip it so the line reads
      // as one message rather than two stacked prefixes.
      const detail = (err as Error).message.replace(/^\[Flow\]\s*/, "");
      frameworkLog("flow").warn(`${PageClass.name} skipped — ${detail}`);
      skipped++;
    };

    // ── Manifest hit: nothing this page's compile reads has changed ──────
    // Decided from file digests alone, so a boot where every page hits never loads the parser.
    // The entry was written after this exact text passed validation, so that is skipped too.
    // A fallback is compiled again when ZT_FLOW_COMPILE_LOG asks for its reason.
    const hit = lookupManifest(source, sourceFile, appRoot, cspSafe);
    if (hit && (hit.outcome === "compiled" || !_explainFallbacks())) {
      if (hit.path === null) {
        skipped++;
        continue;
      }
      try {
        const mod = (await import(pathToFileURL(hit.path).href)) as {
          render: (...a: unknown[]) => unknown;
        };
        PageClass.prototype.render = mod.render;
        if (hit.outcome === "compiled") {
          PageClass.__flowCompiled = true;
          cached++;
        } else {
          injected++;
        }
      } catch (err) {
        fallBack(err);
      }
      continue;
    }

    const compiler = await _loadCompiler();

    // Validate on every boot that compiles, cache hit or not.
    // FlowValidationError propagates here (not caught below) so the server
    // refuses to start when a page references @locked props or non-@expose members
    // from a client callback.
    compiler.validateFlowFile(source, sourceFile);

    try {
      // ── Cache hit ────────────────────────────────────────────────────────
      // Class lists imported from a shared module are folded into the output, so the values
      // that were read are part of the cache key: editing that module must recompile its pages.
      const { strings: constants, imports } = compiler.readImportedStrings(source, sourceFile);
      const variant = staticStringsFingerprint(constants);
      const record = (outcome: CompileOutcome) =>
        writeManifest(source, sourceFile, appRoot, cspSafe, outcome, variant, imports);
      let compiledPath = getCachedPath(source, appRoot, cspSafe, "ts", variant);

      // ── Cache miss — transform and write ─────────────────────────────────
      if (!compiledPath) {
        const report: BlockerReport = {};
        const result = compiler.transformFlowFile(source, sourceFile, {
          cspSafe,
          report,
          constants,
        });
        if (!result) {
          if (_explainFallbacks()) {
            frameworkLog("flow").info(
              `${PageClass.name} renders through the runtime.\n` +
                compiler.describeBlocker(report.blocker, sourceFile).trimEnd(),
            );
          }
          // CSP-safe mode cannot fall back to the runtime renderer (it emits
          // eval-requiring expressions), so an un-compilable page is fatal.
          if (cspSafe) {
            throw new FlowValidationError(
              `[Flow CSP] ${PageClass.name} could not be AOT-compiled, and CSP-safe mode ` +
                `forbids the eval-based runtime fallback. Simplify the page's render().`,
            );
          }
          // Bind-name injection: the page still renders through the runtime jsx()
          // path, but with `__flowBinds` added so component bindings (show/bind/query)
          // resolve statically instead of by the fragile value/capture heuristic.
          // A faithful reprint of render() — if it fails to build or import, the
          // catch below falls back to the untouched runtime render.
          let injPath = getCachedPath(source, appRoot, cspSafe, "tsx");
          if (!injPath) {
            const injectedCode = compiler.buildBindInjectedRender(source, sourceFile);
            if (!injectedCode) {
              await record("runtime");
              skipped++;
              continue; // nothing to inject — plain runtime render
            }
            injPath = await writeCache(source, injectedCode, sourceFile, appRoot, cspSafe, "tsx");
          }
          const injMod = (await import(pathToFileURL(injPath).href)) as {
            render: (...a: unknown[]) => unknown;
          };
          // Patch render but leave __flowCompiled unset: the injected render
          // still uses jsx() and needs the runtime getter instrumentation for the
          // non-component bindings (value=/checked=/text= on intrinsic elements).
          PageClass.prototype.render = injMod.render;
          await record("injected");
          injected++;
          continue;
        }

        const code =
          HELPERS_IMPORT +
          (result.preamble ? result.preamble + "\n\n" : "") +
          `export async function render() {\n${result.renderBody}\n}\n`;

        compiledPath = await writeCache(source, code, sourceFile, appRoot, cspSafe, "ts", variant);
        compiled++;
      } else {
        cached++;
      }

      // ── Dynamic import + prototype patch ──────────────────────────────────
      // Use file:// URL so dynamic import works on both Unix and Windows.
      const mod = (await import(pathToFileURL(compiledPath).href)) as {
        render: (...a: unknown[]) => unknown;
      };
      PageClass.prototype.render = mod.render;
      PageClass.__flowCompiled = true;
      await record("compiled");
    } catch (err) {
      fallBack(err);
    }
  }

  const ms = Date.now() - start;
  if (compiled > 0 || cached > 0 || injected > 0) {
    frameworkLog("flow").info(
      `Compiled ${compiled} page(s), ${cached} from cache, ` +
        `${injected} bind-injected, ${skipped} using runtime`,
      { compiled, cached, injected, runtime: skipped, ms },
    );
  }

  _warnIfMostlyRuntime(compiled + cached + injected + skipped - external, skipped - external);
}

/**
 * Falling back to the runtime renderer for a page or two is normal and correct.
 * A whole app doing it is not: the runtime path resolves `value=`/`checked=`
 * bindings by observing property reads at render time, which is necessarily
 * weaker than the compiler reading the same intent out of the AST. An app that
 * never compiles is relying on that weaker path everywhere without being told.
 *
 * So the per-page reasons stay behind ZT_FLOW_COMPILE_LOG (they are noise at a
 * handful of pages), but the *rate* is reported unconditionally once it passes
 * half. The message names the flag, because knowing which construct blocks each
 * page is the only actionable next step.
 *
 * Both figures cover only the app's own pages. A fresh admin app was told 12 of 12 of its
 * pages fell back, all of them the panel's, which come from a package and which its authors
 * cannot change.
 */
function _warnIfMostlyRuntime(total: number, runtime: number): void {
  if (total < MIN_PAGES_FOR_FALLBACK_WARNING) return;
  if (runtime * 2 <= total) return;
  if (_explainFallbacks()) return; // already printing a reason per page

  const pct = Math.round((runtime / total) * 100);
  frameworkLog("flow").warn(
    `${runtime} of ${total} Flow pages (${pct}%) render through the runtime fallback ` +
      `instead of compiled output.\n` +
      `  Set ZT_FLOW_COMPILE_LOG=1 to print what blocks each page.`,
    { total, runtime, pct },
  );
}

/** Below this, a high percentage is not yet evidence of anything. */
const MIN_PAGES_FOR_FALLBACK_WARNING = 4;
