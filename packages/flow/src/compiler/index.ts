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

import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _appFilesEmbedded, _importAppFile, _scanAppFiles } from "@zerotal/core/runtime";
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
  const [transform, constants, components] = await Promise.all([
    import("./transform.ts"),
    import("./constants.ts"),
    import("./components.ts"),
  ]);
  return {
    validateFlowFile: transform.validateFlowFile,
    transformFlowFile: transform.transformFlowFile,
    buildBindInjectedRender: transform.buildBindInjectedRender,
    describeBlocker: transform.describeBlocker,
    readImportedStrings: constants.readImportedStrings,
    readImportedComponents: components.readImportedComponents,
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

const HELPERS_IMPORT = `import { __esc, __escAttr, __attr } from '@zerotal/flow/compiler-helpers';\n\n`;

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

  const embedded = _appFilesEmbedded();
  await _locateRegisteredPages(appRoot, entries.values());

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

    let build: PageBuild;
    if (embedded) {
      // A compiled binary carries no page sources. `bun zt compile` compiled each page when it
      // built the binary, and the outcome is what it recorded.
      const recorded = _embeddedPageBuild(sourceFile, cspSafe);
      if (!recorded) {
        skipped++;
        continue;
      }
      if ("validation" in recorded) throw new FlowValidationError(recorded.validation);
      if ("error" in recorded) {
        fallBack(new Error(recorded.error));
        continue;
      }
      build = recorded;
    } else {
      const source = await Bun.file(sourceFile).text();

      // ── Manifest hit: nothing this page's compile reads has changed ──────
      // Decided from file digests alone, so a boot where every page hits never loads the parser.
      // The entry was written after this exact text passed validation, so that is skipped too.
      // A fallback is compiled again when ZT_FLOW_COMPILE_LOG asks for its reason.
      const hit = lookupManifest(source, sourceFile, appRoot, cspSafe);
      if (hit && (hit.outcome === "compiled" || !_explainFallbacks())) {
        build = { ...hit, fresh: false };
      } else {
        const compiler = await _loadCompiler();

        // Validate on every boot that compiles, cache hit or not.
        // FlowValidationError propagates here (not caught below) so the server
        // refuses to start when a page references @locked props or non-@expose members
        // from a client callback.
        compiler.validateFlowFile(source, sourceFile);

        try {
          build = await _buildPage(compiler, source, sourceFile, appRoot, cspSafe, PageClass.name);
        } catch (err) {
          fallBack(err);
          continue;
        }
      }
    }

    if (build.path === null) {
      await build.record?.();
      skipped++;
      continue;
    }
    try {
      // Use file:// URL so dynamic import works on both Unix and Windows.
      const mod = await _importAppFile<{ render: (...a: unknown[]) => unknown }>(
        pathToFileURL(build.path).href,
      );
      PageClass.prototype.render = mod.render;
      if (build.outcome === "compiled") {
        PageClass.__flowCompiled = true;
        if (build.fresh) compiled++;
        else cached++;
      } else {
        // Patch render but leave __flowCompiled unset: the injected render
        // still uses jsx() and needs the runtime getter instrumentation for the
        // non-component bindings (value=/checked=/text= on intrinsic elements).
        injected++;
      }
      await build.record?.();
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

/** Where an app keeps its Flow pages, from the project root. */
const PAGES_DIRECTORY = join("app", "flow", "pages");

/**
 * Give each page registered from code its source file, so it is compiled like a file-routed one.
 *
 * The file router tells a page where it lives. `Router.flow("/login", LoginPage)` does not: the
 * class arrives without a file, and was left to the runtime renderer — every page of an app that
 * lists its pages in a route file, rather than only the pages a package registers. Such a page
 * almost always sits under app/flow/pages/, so that directory is read for the file that exports
 * the very class registered. The module is the one the route file already loaded, so importing
 * it costs nothing and identity is exact; a class found nowhere there stays on the runtime. A
 * binary carries the same files, so this finds them there too.
 */
async function _locateRegisteredPages(
  appRoot: string,
  entries: Iterable<{ PageClass: unknown }>,
): Promise<void> {
  const unplaced = new Set<unknown>();
  for (const { PageClass } of entries) {
    if (!(PageClass as { __sourceFile?: string }).__sourceFile) unplaced.add(PageClass);
  }
  if (unplaced.size === 0) return;

  const directory = join(appRoot, PAGES_DIRECTORY);
  for (const file of await _scanAppFiles(directory, "**/*.{ts,tsx}")) {
    if (/\.(test|spec)\.tsx?$/.test(file)) continue;
    const path = join(directory, file);
    let module: Record<string, unknown>;
    try {
      module = await _importAppFile(pathToFileURL(path).href);
    } catch {
      continue;
    }
    for (const value of Object.values(module)) {
      if (!unplaced.has(value)) continue;
      (value as { __sourceFile?: string }).__sourceFile = path;
      unplaced.delete(value);
    }
    if (unplaced.size === 0) return;
  }
}

/** The compiler's parser-backed half, as {@link _loadCompiler} returns it. */
type Compiler = Awaited<ReturnType<typeof _loadCompiler>>;

/**
 * How one page came out of the compiler: the module whose `render` replaces the page's, unless
 * it renders through the runtime untouched.
 */
interface PageBuild {
  outcome: CompileOutcome;
  /** The compiled `render()` module, or `null` for a page that renders through the runtime. */
  path: string | null;
  /** Compiled by this call rather than found in the cache. */
  fresh: boolean;
  /** Writes the manifest entry, once the module has loaded. */
  record?: () => Promise<void>;
}

/**
 * Compile one validated page, or find its compile in the cache.
 *
 * Throws for a page that cannot be compiled; the caller decides whether that falls back to the
 * runtime or, under CSP, stops the boot.
 */
async function _buildPage(
  compiler: Compiler,
  source: string,
  sourceFile: string,
  appRoot: string,
  cspSafe: boolean,
  className: string,
): Promise<PageBuild> {
  // ── Cache hit ────────────────────────────────────────────────────────
  // Class lists imported from a shared module are folded into the output, so the values
  // that were read are part of the cache key: editing that module must recompile its pages.
  // A function component the page renders is compiled into it, so the text of its module (and
  // of what that module reads class lists from) is part of the key in the same way.
  const { strings: constants, imports } = compiler.readImportedStrings(source, sourceFile);
  const components = compiler.readImportedComponents(source, sourceFile);
  const variant =
    staticStringsFingerprint(constants) +
    (components.fingerprint ? `+components:${components.fingerprint}` : "");
  const tracked = [...imports];
  for (const read of components.imports) {
    if (read.file === null || !tracked.some((known) => known.file === read.file)) {
      tracked.push(read);
    }
  }
  const recorder = (outcome: CompileOutcome) => () =>
    writeManifest(source, sourceFile, appRoot, cspSafe, outcome, variant, tracked);

  const cachedPath = getCachedPath(source, appRoot, cspSafe, "ts", variant);
  if (cachedPath) {
    return { outcome: "compiled", path: cachedPath, fresh: false, record: recorder("compiled") };
  }

  // ── Cache miss — transform and write ─────────────────────────────────
  const report: BlockerReport = {};
  const result = compiler.transformFlowFile(source, sourceFile, {
    cspSafe,
    report,
    constants,
    components: components.components,
  });
  if (result) {
    const code =
      HELPERS_IMPORT +
      (result.preamble ? result.preamble + "\n\n" : "") +
      `export async function render() {\n${result.renderBody}\n}\n`;
    const path = await writeCache(source, code, sourceFile, appRoot, cspSafe, "ts", variant);
    return { outcome: "compiled", path, fresh: true, record: recorder("compiled") };
  }

  if (_explainFallbacks()) {
    frameworkLog("flow").info(
      `${className} renders through the runtime.\n` +
        compiler.describeBlocker(report.blocker, sourceFile).trimEnd(),
    );
  }
  // CSP-safe mode cannot fall back to the runtime renderer (it emits
  // eval-requiring expressions), so an un-compilable page is fatal.
  if (cspSafe) {
    throw new FlowValidationError(
      `[Flow CSP] ${className} could not be AOT-compiled, and CSP-safe mode ` +
        `forbids the eval-based runtime fallback. Simplify the page's render().`,
    );
  }
  // Bind-name injection: the page still renders through the runtime jsx()
  // path, but with `__flowBinds` added so component bindings (show/bind/query)
  // resolve statically instead of by the fragile value/capture heuristic.
  // A faithful reprint of render() — if it fails to build or import, the
  // caller falls back to the untouched runtime render.
  let injectedPath = getCachedPath(source, appRoot, cspSafe, "tsx");
  if (!injectedPath) {
    const injectedCode = compiler.buildBindInjectedRender(source, sourceFile);
    if (!injectedCode) {
      // Nothing to inject — plain runtime render.
      return { outcome: "runtime", path: null, fresh: true, record: recorder("runtime") };
    }
    injectedPath = await writeCache(source, injectedCode, sourceFile, appRoot, cspSafe, "tsx");
  }
  return { outcome: "injected", path: injectedPath, fresh: true, record: recorder("injected") };
}

/**
 * What `bun zt compile` recorded for one page and one CSP mode: its compiled module, or the error
 * its compile failed with. `validation` is a failure that stops a boot, as it would have on disk.
 *
 * @internal
 */
export type EmbeddedPageBuild =
  | { outcome: CompileOutcome; path: string | null; fresh: false }
  | { error: string }
  | { validation: string };

/** Root-relative source path → `[without CSP, with CSP]`. */
let _embeddedBuilds: Record<string, [EmbeddedPageBuild | null, EmbeddedPageBuild | null]> = {};

/**
 * Register the page compiles a binary carries. Called by the entry `bun zt compile` generates.
 * Paths are root-relative, with forward slashes.
 *
 * @internal
 */
export function _embedPageBuilds(
  builds: Record<string, [EmbeddedPageBuild | null, EmbeddedPageBuild | null]>,
): void {
  _embeddedBuilds = builds;
}

/** The recorded compile for a page in a binary, with its module path made absolute. */
function _embeddedPageBuild(sourceFile: string, cspSafe: boolean): EmbeddedPageBuild | null {
  const key = relative(process.cwd(), sourceFile).split(sep).join("/");
  const recorded = _embeddedBuilds[key]?.[cspSafe ? 1 : 0] ?? null;
  if (!recorded || !("outcome" in recorded) || recorded.path === null) return recorded;
  return { ...recorded, path: resolve(process.cwd(), recorded.path) };
}

/** `from "file:///…"`, as the compiler writes an import of a module beside the page. */
const FILE_URL_SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(file:\/\/[^"']+)\2/g;

/**
 * A copy of a compiled module, for the binary to carry, that imports by path where the cached one
 * imports by `file://` URL.
 *
 * The cache imports a page's neighbours by URL so that loading it at runtime works on Windows,
 * where a bare drive-letter path reads as a URL scheme. Bun 1.3's bundler does not resolve a
 * `file://` specifier, so the build gets a copy that names each module by its path instead.
 */
async function _bundleableCopy(appRoot: string, compiledPath: string): Promise<string> {
  const code = await Bun.file(compiledPath).text();
  const rewritten = code.replace(
    FILE_URL_SPECIFIER,
    (_match, lead: string, quote: string, url: string) =>
      `${lead}${quote}${fileURLToPath(url).split(sep).join("/")}${quote}`,
  );
  const copy = join(appRoot, ".zerotal", "compile", "flow", basename(compiledPath));
  await Bun.write(copy, rewritten);
  return copy;
}

/**
 * Compile the given files ahead of time for `bun zt compile`, in both CSP modes, and say how
 * each came out. A file that holds no page compiles to `runtime` and costs nothing at boot.
 *
 * @param appRoot - The project root, which holds `.zerotal/`.
 * @param files - Root-relative source files.
 * @returns The outcome per file, with module paths relative to the root, and the compiled
 *   modules the binary has to carry.
 * @internal
 */
export async function _precompilePages(
  appRoot: string,
  files: readonly string[],
): Promise<{
  builds: Record<string, [EmbeddedPageBuild | null, EmbeddedPageBuild | null]>;
  modules: string[];
}> {
  const builds: Record<string, [EmbeddedPageBuild | null, EmbeddedPageBuild | null]> = {};
  const modules = new Set<string>();
  const toRoot = (path: string) => relative(appRoot, path).split(sep).join("/");
  let compiler: Compiler | undefined;
  for (const file of files) {
    if (!/\.tsx?$/.test(file)) continue;
    const sourceFile = resolve(appRoot, file);
    const source = await Bun.file(sourceFile).text();
    // Only a class with a render() can be a page; anything else is never asked for.
    if (!source.includes("render(")) continue;
    compiler ??= await _loadCompiler();
    const outcomes: [EmbeddedPageBuild | null, EmbeddedPageBuild | null] = [null, null];
    for (const cspSafe of [false, true]) {
      let outcome: EmbeddedPageBuild;
      try {
        compiler.validateFlowFile(source, sourceFile);
      } catch (err) {
        outcomes[cspSafe ? 1 : 0] = { validation: (err as Error).message };
        continue;
      }
      try {
        const build = await _buildPage(compiler, source, sourceFile, appRoot, cspSafe, file);
        outcome = {
          outcome: build.outcome,
          path: build.path === null ? null : toRoot(build.path),
          fresh: false,
        };
        if (build.path !== null) {
          const copy = await _bundleableCopy(appRoot, build.path);
          outcome = { ...outcome, path: toRoot(copy) };
          modules.add(toRoot(copy));
        }
      } catch (err) {
        outcome = { error: (err as Error).message };
      }
      outcomes[cspSafe ? 1 : 0] = outcome;
    }
    builds[file] = outcomes;
  }
  return { builds, modules: [...modules].sort() };
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
