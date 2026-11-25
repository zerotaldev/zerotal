/**
 * A boot whose pages are all in the compile cache never loads `typescript`.
 *
 * The compiler needs the TypeScript parser, and it is the heaviest thing a Flow app loads. It
 * used to load on every boot, even when every page came out of the cache, because a cache hit
 * still parsed each page twice: once to validate it, once to read the constants it imports,
 * which are part of the cache key. The cache now keeps a manifest per page recording what that
 * parse found, so a hit is decided from file digests and the parser is imported only on a miss.
 *
 * Each boot runs in a fresh process, as a server start or a dev reload does, so that "was the
 * module loaded" has a clean answer. The signal is a loader hook preloaded into that process,
 * which throws the moment `typescript.js` is read: a boot that needed the parser fails, and says
 * so. Every test that expects a TypeScript-free boot also has a boot in which the same hook does
 * fire, so a hook that stopped matching cannot pass them by seeing nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const FLOW = join(SRC, "..");
const TIMEOUT = 60_000;

/**
 * Throws when `typescript.js` loads, and leaves the path behind for the boot to report.
 * (A Bun loader filter cannot use `[\\/]`, which matches nothing, hence the `.` separators.)
 */
const TRIPWIRE = `import { plugin } from "bun";
plugin({
  name: "typescript-tripwire",
  setup(build) {
    build.onLoad({ filter: /typescript.lib.typescript\\.js$/ }, (args) => {
      globalThis.__typescriptLoaded = args.path;
      throw new Error("typescript was loaded");
    });
  },
});
`;

/** Registers one stub class per page, runs the compile step, and reports what came of it. */
function bootScript(root: string, pages: readonly string[], cspSafe: boolean): string {
  const at = (p: string) => JSON.stringify(pathToFileURL(join(SRC, p)).href);
  return `import { join } from "node:path";
const out = { typescript: null, error: null, pages: {} };
try {
  const { Component } = await import(${at("Component.ts")});
  const { registerPage } = await import(${at("registry.ts")});
  const classes = {};
  for (const name of ${JSON.stringify(pages)}) {
    const Page = class extends Component {};
    Object.defineProperty(Page, "name", { value: name });
    Page.__sourceFile = join(${JSON.stringify(root)}, "pages", name + ".tsx");
    registerPage("/" + name, Page);
    classes[name] = Page;
  }
  const { compileRegisteredPages } = await import(${at("compiler/index.ts")});
  await compileRegisteredPages(${JSON.stringify(root)}, ${cspSafe});
  for (const [name, Page] of Object.entries(classes)) {
    out.pages[name] = Page.__flowCompiled
      ? "compiled"
      : Object.hasOwn(Page.prototype, "render") ? "injected" : "runtime";
  }
} catch (e) {
  out.error = String(e?.message ?? e);
}
out.typescript = globalThis.__typescriptLoaded ?? null;
await Bun.sleep(0);
console.log("RESULT " + JSON.stringify(out));
`;
}

interface Boot {
  /** Where `typescript.js` was loaded from, or null when it never was. Only set with the tripwire. */
  typescript: string | null;
  error: string | null;
  pages: Record<string, "compiled" | "injected" | "runtime">;
  /** Everything else the boot printed: the compiler's summary line, warnings. */
  log: string;
}

let root: string;

/** Boot the fixture app in a fresh process. */
async function boot(
  pages: readonly string[],
  opts: { tripwire?: boolean; cspSafe?: boolean; env?: Record<string, string> } = {},
): Promise<Boot> {
  const script = join(root, "boot.ts");
  await writeFile(script, bootScript(root, pages, opts.cspSafe ?? false));
  const args = opts.tripwire ? ["--preload", join(root, "tripwire.ts")] : [];
  const proc = Bun.spawnSync([process.execPath, ...args, script], {
    cwd: FLOW,
    env: { ...process.env, NO_COLOR: "1", ...opts.env },
  });
  const stdout = proc.stdout.toString();
  const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`the boot printed no result:\n${stdout}\n${proc.stderr.toString()}`);
  return { ...(JSON.parse(line.slice(7)) as Omit<Boot, "log">), log: stdout };
}

/** The compiler's own summary: "Compiled N page(s), N from cache, N bind-injected, N using runtime". */
function summary(b: Boot): string {
  return (
    /Compiled \d+ page\(s\), \d+ from cache, \d+ bind-injected, \d+ using runtime/.exec(
      b.log,
    )?.[0] ?? "(no summary)"
  );
}

const page = (name: string, body: string, head = "") => `/** @jsxImportSource @zerotal/flow */
import { Component, expose } from "@zerotal/flow";
${head}
export class ${name} extends Component {
  @expose open = false;
  override async render() { return (${body}); }
}
`;

/** Compiles: a static class list read out of a shared module. */
const HOME = page("Home", `<div class={CARD}>home</div>`, `import { CARD } from "../ui";`);
/** Compiles too, through a module that is not there yet when the test starts. */
const THEMED = page("Themed", `<div class={TONE}>themed</div>`, `import { TONE } from "../theme";`);
/** A style object: the compiler leaves the page to the runtime, with nothing to inject. */
const PLAIN = page("Plain", `<div style={{ color: "red" }}>plain</div>`);
/** A component with a `show` binding: rendered by the runtime, with its binding named. */
const INJECTED = page(
  "Injected",
  `<Panel show={this.open}><p>injected</p></Panel>`,
  `function Panel(props: { show?: boolean; children?: unknown }): unknown { return props.children; }`,
);

const write = (path: string, text: string) => writeFile(join(root, path), text);

async function cacheFiles(): Promise<string[]> {
  return (await readdir(join(root, ".zerotal", "compiled"))).sort();
}

beforeEach(async () => {
  // Inside the package, not the OS temp directory: compiled output imports `@zerotal/flow`, which
  // has to resolve from where the cache is.
  root = join(FLOW, `.tmp-warm-boot-${process.pid}-${Date.now()}`);
  await mkdir(join(root, "pages"), { recursive: true });
  await write("tripwire.ts", TRIPWIRE);
  await write("ui.ts", `export const CARD = "p-4 rounded";\n`);
  await write("pages/Home.tsx", HOME);
  await write("pages/Plain.tsx", PLAIN);
  await write("pages/Injected.tsx", INJECTED);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("a warm boot", () => {
  const PAGES = ["Home", "Plain", "Injected"];

  it(
    "does not load typescript, and serves every page as the cold boot left it",
    async () => {
      // The tripwire fires on a cold cache: this is what proves it is watching.
      const tripped = await boot(PAGES, { tripwire: true });
      expect(tripped.typescript).toMatch(/typescript/);
      expect(tripped.error).toContain("typescript was loaded");

      const cold = await boot(PAGES);
      expect(cold.error).toBeNull();
      expect(cold.pages).toEqual({ Home: "compiled", Plain: "runtime", Injected: "injected" });
      expect(summary(cold)).toBe(
        "Compiled 1 page(s), 0 from cache, 1 bind-injected, 1 using runtime",
      );

      const warm = await boot(PAGES, { tripwire: true });
      expect(warm.error).toBeNull();
      expect(warm.typescript).toBeNull();
      expect(warm.pages).toEqual(cold.pages);
      expect(summary(warm)).toBe(
        "Compiled 0 page(s), 1 from cache, 1 bind-injected, 1 using runtime",
      );
    },
    TIMEOUT,
  );

  it(
    "under cspSafe does not load typescript either",
    async () => {
      const csp = ["Home"];
      expect((await boot(csp, { cspSafe: true, tripwire: true })).typescript).toMatch(/typescript/);
      expect((await boot(csp, { cspSafe: true })).pages).toEqual({ Home: "compiled" });

      const warm = await boot(csp, { cspSafe: true, tripwire: true });
      expect(warm.error).toBeNull();
      expect(warm.typescript).toBeNull();
      expect(warm.pages).toEqual({ Home: "compiled" });

      // The two modes keep separate entries: a default boot is cold again.
      expect((await boot(csp, { tripwire: true })).typescript).toMatch(/typescript/);
    },
    TIMEOUT,
  );

  it(
    "still explains each fallback when ZT_FLOW_COMPILE_LOG asks, which needs the parser",
    async () => {
      await boot(PAGES);
      const explained = await boot(PAGES, { env: { ZT_FLOW_COMPILE_LOG: "1" } });
      expect(explained.log).toContain("Plain renders through the runtime.");
      expect(explained.pages).toEqual({ Home: "compiled", Plain: "runtime", Injected: "injected" });
    },
    TIMEOUT,
  );
});

describe("a boot after a change (a dev reload)", () => {
  it(
    "recompiles the page whose source changed and keeps the rest",
    async () => {
      await boot(["Home", "Plain"]);
      await write("pages/Home.tsx", HOME.replace(">home<", ">home, edited<"));

      expect((await boot(["Home", "Plain"], { tripwire: true })).typescript).toMatch(/typescript/);
      const reloaded = await boot(["Home", "Plain"]);
      expect(reloaded.pages).toEqual({ Home: "compiled", Plain: "runtime" });
      expect(summary(reloaded)).toBe(
        "Compiled 1 page(s), 0 from cache, 0 bind-injected, 1 using runtime",
      );
      const outputs = await Promise.all(
        (await cacheFiles())
          .filter((f) => f.endsWith(".ts"))
          .map((f) => readFile(join(root, ".zerotal", "compiled", f), "utf8")),
      );
      expect(outputs.some((o) => o.includes("home, edited"))).toBe(true);

      // And the boot after that is warm again.
      expect((await boot(["Home", "Plain"], { tripwire: true })).typescript).toBeNull();
    },
    TIMEOUT,
  );

  it(
    "recompiles a page when a module it reads constants from changes",
    async () => {
      await boot(["Home"]);
      await write("ui.ts", `export const CARD = "p-8 shadow";\n`);

      expect((await boot(["Home"], { tripwire: true })).typescript).toMatch(/typescript/);
      const reloaded = await boot(["Home"]);
      expect(summary(reloaded)).toBe(
        "Compiled 1 page(s), 0 from cache, 0 bind-injected, 0 using runtime",
      );
      const outputs = await Promise.all(
        (await cacheFiles())
          .filter((f) => f.endsWith(".ts"))
          .map((f) => readFile(join(root, ".zerotal", "compiled", f), "utf8")),
      );
      expect(outputs.some((o) => o.includes("p-8 shadow"))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "recompiles a page when its import starts resolving to a different file",
    async () => {
      await write("pages/Themed.tsx", THEMED);
      // `../theme` resolves to nothing yet: the page cannot read TONE and falls back.
      expect((await boot(["Themed"])).pages).toEqual({ Themed: "runtime" });
      expect((await boot(["Themed"], { tripwire: true })).typescript).toBeNull();

      // Nothing about the page changed, only what its import finds.
      await write("theme.tsx", `export const TONE = "text-slate-700";\n`);
      expect((await boot(["Themed"], { tripwire: true })).typescript).toMatch(/typescript/);
      expect((await boot(["Themed"])).pages).toEqual({ Themed: "compiled" });

      // `theme.ts` comes before `theme.tsx` in resolution order, so it now wins.
      await write("theme.ts", `export const TONE = "text-slate-900";\n`);
      expect((await boot(["Themed"], { tripwire: true })).typescript).toMatch(/typescript/);
      expect((await boot(["Themed"])).pages).toEqual({ Themed: "compiled" });
      const outputs = await Promise.all(
        (await cacheFiles())
          .filter((f) => f.endsWith(".ts"))
          .map((f) => readFile(join(root, ".zerotal", "compiled", f), "utf8")),
      );
      expect(outputs.some((o) => o.includes("text-slate-900"))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "recompiles a page whose compiled file has gone, even with its manifest still there",
    async () => {
      await boot(["Home"]);
      for (const f of await cacheFiles()) {
        if (f.endsWith(".ts")) await unlink(join(root, ".zerotal", "compiled", f));
      }
      expect((await boot(["Home"], { tripwire: true })).typescript).toMatch(/typescript/);
      expect((await boot(["Home"])).pages).toEqual({ Home: "compiled" });
    },
    TIMEOUT,
  );
});

describe("validation", () => {
  it(
    "refuses an invalid page on every boot: nothing is cached that would let it through",
    async () => {
      await write(
        "pages/Bad.tsx",
        page("Bad", `<button onClick={this.submit}>Send</button>`).replace(
          "@expose open = false;",
          "async submit() {}",
        ),
      );
      for (let i = 0; i < 2; i++) {
        const b = await boot(["Bad"]);
        expect(b.error).toMatch(/not @expose'd/);
      }
    },
    TIMEOUT,
  );
});
