/**
 * Flow AOT compiler — orchestrates compilation of all registered Pages.
 *
 * Called once by FlowProvider.onBooting() before the server accepts requests.
 * For each page that has a __sourceFile stored on it (set by the file-route
 * resolver), we:
 *   1. Read the source
 *   2. Hash it and check .zerotal/compiled/ cache
 *   3. On miss: transform() → write to cache
 *   4. dynamic-import the compiled file
 *   5. Patch PageClass.prototype.render + set __flowCompiled = true
 *
 * Pages that fall back (unsupported JSX patterns, manually-registered routes
 * without __sourceFile) continue using the standard runtime transparently.
 */

import { pathToFileURL } from "node:url";
import { frameworkLog } from "@zerotal/core/logger";
import {
  transformFlowFile,
  buildBindInjectedRender,
  validateFlowFile,
  describeBlocker,
  FlowValidationError,
  type BlockerReport,
} from "./transform.ts";
import { getCachedPath, writeCache } from "./cache.ts";

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
      continue;
    }

    // Already compiled in this process (e.g. shared base class registered twice)
    if (PageClass.__flowCompiled) {
      cached++;
      continue;
    }

    const source = await Bun.file(sourceFile).text();

    // Validate unconditionally — runs even on cache hits.
    // FlowValidationError propagates here (not caught below) so the server
    // refuses to start when a page references @locked props or non-@expose members
    // from a client callback.
    validateFlowFile(source, sourceFile);

    try {
      // ── Cache hit ────────────────────────────────────────────────────────
      let compiledPath = getCachedPath(source, appRoot, cspSafe);

      // ── Cache miss — transform and write ─────────────────────────────────
      if (!compiledPath) {
        const report: BlockerReport = {};
        const result = transformFlowFile(source, sourceFile, { cspSafe, report });
        if (!result) {
          if (_explainFallbacks()) {
            frameworkLog("flow").info(
              `${PageClass.name} renders through the runtime.\n` +
                describeBlocker(report.blocker, sourceFile).trimEnd(),
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
            const injectedCode = buildBindInjectedRender(source, sourceFile);
            if (!injectedCode) {
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
          injected++;
          continue;
        }

        const code =
          HELPERS_IMPORT +
          (result.preamble ? result.preamble + "\n\n" : "") +
          `export async function render() {\n${result.renderBody}\n}\n`;

        compiledPath = await writeCache(source, code, sourceFile, appRoot, cspSafe);
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
    } catch (err) {
      // In CSP-safe mode there is no safe runtime fallback — surface the error so
      // the server refuses to boot and the developer fixes the page.
      if (cspSafe) throw err;
      // Otherwise a non-fatal compile failure falls back to the runtime renderer.
      // Compiler errors already carry a `[Flow]` tag; strip it so the line reads
      // as one message rather than two stacked prefixes.
      const detail = (err as Error).message.replace(/^\[Flow\]\s*/, "");
      frameworkLog("flow").warn(`${PageClass.name} skipped — ${detail}`);
      skipped++;
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

  _warnIfMostlyRuntime(compiled + cached + injected + skipped, skipped);
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
