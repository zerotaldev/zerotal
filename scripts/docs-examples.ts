#!/usr/bin/env bun
/**
 * Compile every TypeScript example in `docs/` against the real workspace types.
 *
 * Documentation drifts silently. A signature changes, the guide keeps the old
 * call, and nothing complains until a reader copies it — at which point the
 * framework looks broken rather than the page. Every other promise this repo
 * makes about itself is checked by a gate; the examples were the last surface
 * where "it still works" was a memory rather than a build step.
 *
 * ## Fragments
 *
 * Not every block is a program. Plenty of them are deliberately a class body, a
 * handful of columns, or a method with no class around it — the shape that
 * explains a thing best is often not the shape that compiles. Those are marked
 * by the author, in the fence:
 *
 * ```ts fragment
 * ```tsx fragment
 * ```typescript fragment
 *
 * The token is invisible to readers: markdown info strings carry only their
 * first word into the rendered `class="language-…"`, so the page is unchanged.
 *
 * **Never inferred.** A heuristic that guesses which blocks are fragments would
 * quietly excuse exactly the blocks that are broken, which is the failure this
 * gate exists to catch. A block is a fragment because someone wrote that it is.
 *
 * ## The allowlist is keyed, not counted
 *
 * `docs-examples-baseline.json` records every fragment by document, heading,
 * position under that heading, and a hash of its normalised source. A bare count
 * would let one fragment be deleted and a different one introduced without the
 * number moving — the ratchet would read as held while the corpus quietly got
 * worse. Four keys mean a new fragment is a new entry, and an edited one is too.
 *
 * The list only shrinks on its own: a marked fragment that turns out to compile
 * standalone is no longer a fragment, and `--check` says so rather than letting
 * the exemption sit there covering nothing.
 *
 * ## Usage
 *
 *     bun run scripts/docs-examples.ts            # update the allowlist
 *     bun run scripts/docs-examples.ts --check    # CI: fail on drift
 *     bun run scripts/docs-examples.ts --seed     # one-time: mark what fails
 */
import { Glob } from "bun";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";

const ROOT = join(import.meta.dir, "..");
const DOCS = join(ROOT, "docs");
/**
 * Where the extracted blocks are compiled.
 *
 * Inside `apps/docs`, not at the repo root, because that is where the examples'
 * imports resolve: the root `node_modules` carries one workspace link, while the
 * documentation app has the full dependency set and the `paths` mapping that
 * points `@zerotal/*` at the packages' sources. Compiling at the root reported
 * `Cannot find module 'zerotal'` for two thirds of the corpus — a resolution
 * failure dressed up as broken documentation.
 *
 * It is also the honest place. Documentation examples are written as application
 * code, and this is a real application.
 */
//
// Buried several levels deep, because an example's relative imports resolve from
// wherever the unit sits. `docs/routing.md` writes `../bootstrap/app.ts` meaning
// the reader's app — and with the units one level under `apps/docs`, that found
// the *documentation app's own* bootstrap and checked the page against it,
// reporting a mismatch as though the example were wrong. The empty directories
// above the units absorb `../`, `../../` and `../../../`, so those imports miss
// as they should, while `node_modules` still resolves by walking up.
//
// Suffixed with the process id because two runs share nothing else: the first
// thing a run does is delete this directory, so a second invocation started
// while one is compiling erases its inputs mid-check and the results are
// nonsense — fragments reported as compiling, drift reported as clean. Cheap to
// make impossible rather than rare.
const WORK = join(ROOT, "apps", "docs", `.docs-examples-${process.pid}`, "a", "b", "units");

/** How far `WORK` sits below `apps/docs`, for the generated config's relative paths. */
const WORK_DEPTH = 4;
const BASELINE = join(ROOT, "docs-examples-baseline.json");

/** Fence languages that hold TypeScript. Anything else is not this gate's business. */
const TS_LANGS = new Set(["ts", "tsx", "typescript"]);

/** The token an author writes to say "this is not a whole program". */
const FRAGMENT_TOKEN = "fragment";

interface Block {
  /** Repo-relative, forward slashes — the key has to be stable across platforms. */
  file: string;
  /** Nearest preceding heading; `""` for a block above the first one. */
  heading: string;
  /** Which block this is under that heading, counting from zero. */
  ordinal: number;
  /** 1-based line of the opening fence, for a message someone can act on. */
  line: number;
  lang: string;
  fragment: boolean;
  code: string;
  hash: string;
  jsx: boolean;
}

interface Entry {
  file: string;
  heading: string;
  ordinal: number;
  hash: string;
}

// ── Extraction ────────────────────────────────────────────────────────────────

/**
 * Whether `code` contains JSX, as opposed to a generic that merely looks like it.
 *
 * `Array<string>` is not JSX and must not land in a `.tsx` file, where `<T>` type
 * assertions stop parsing. Closing and self-closing tags are the two shapes that
 * cannot be anything else.
 *
 * This decides an extension and nothing more. It is not evidence about whether a
 * block is a fragment — JSX blocks compile as readily as any other.
 */
function hasJsx(code: string): boolean {
  return /<\/[A-Za-z]/.test(code) || /<[A-Za-z][\w.]*[^>]*\/>/.test(code);
}

/** Line endings and trailing whitespace out, so a re-indent is not a new fragment. */
function normalise(code: string): string {
  return code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}

function hashOf(code: string): string {
  return Bun.hash(normalise(code)).toString(36).padStart(12, "0").slice(0, 12);
}

/**
 * Every TypeScript block in one document.
 *
 * Written as a line walk rather than one regex because fences nest: a page that
 * shows markdown containing a code block wraps it in a longer fence, and a
 * regex pairing the first ``` with the next one splits that in half.
 */
function blocksIn(file: string, source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];

  let heading = "";
  let ordinal = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    const head = line.match(/^#{1,6}\s+(.*?)\s*$/);
    if (head) {
      heading = head[1]!.replace(/\s*\{#.*\}$/, "").trim();
      ordinal = 0;
      i++;
      continue;
    }

    const open = line.match(/^(\s*)(`{3,})(.*)$/);
    if (!open) {
      i++;
      continue;
    }

    const [, indent = "", ticks = "```", info = ""] = open;
    const close = new RegExp(`^\\s*\`{${ticks.length},}\\s*$`);
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j]!)) {
      // Fences inside a list item are indented with their content.
      body.push(lines[j]!.startsWith(indent) ? lines[j]!.slice(indent.length) : lines[j]!);
      j++;
    }

    const words = info.trim().split(/\s+/).filter(Boolean);
    const lang = (words[0] ?? "").toLowerCase();

    if (TS_LANGS.has(lang)) {
      const code = body.join("\n");
      out.push({
        file,
        heading,
        ordinal: ordinal++,
        line: i + 1,
        lang,
        fragment: words.slice(1).includes(FRAGMENT_TOKEN),
        code,
        hash: hashOf(code),
        jsx: hasJsx(code),
      });
    }

    i = j + 1;
  }

  return out;
}

async function collect(): Promise<Block[]> {
  const blocks: Block[] = [];
  for await (const rel of new Glob("**/*.md").scan({ cwd: DOCS })) {
    const path = rel.replace(/\\/g, "/");
    // TypeDoc output: generated from docblocks that `typecheck` already covers,
    // thousands of pages wide, and not written by hand.
    if (path.startsWith("api/")) continue;
    const source = await Bun.file(join(DOCS, rel)).text();
    blocks.push(...blocksIn(`docs/${path}`, source));
  }
  return blocks.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ── Compilation ───────────────────────────────────────────────────────────────

/**
 * `paths` covering every workspace package, derived from their own export maps.
 *
 * The documentation app depends on most packages but not all of it — it has no
 * reason to install `@zerotal/tenancy` or `@zerotal/telemetry`, and the pages
 * documenting those import them anyway, as a reader's app would. Without this the
 * gate reported `Cannot find module '@zerotal/tenancy'` and the honest fix would
 * have been to mark two dozen accurate examples as fragments, baking in an
 * exemption for a resolution gap rather than for anything about the code.
 *
 * Read from each `package.json` rather than listed here, so a new package or a new
 * subpath is covered the day it exists.
 */
/**
 * The source file behind one `exports` entry, string or conditional.
 *
 * `default` first, then the type-only and import conditions — the browser build
 * last, since an example is being checked as source rather than shipped.
 */
function resolveCondition(target: unknown): string | null {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return null;
  const map = target as Record<string, unknown>;
  for (const key of ["default", "types", "import", "bun", "node", "browser"]) {
    const value = resolveCondition(map[key]);
    if (value) return value;
  }
  return null;
}

async function workspacePaths(): Promise<Record<string, string[]>> {
  const paths: Record<string, string[]> = {};
  for await (const rel of new Glob("*/package.json").scan({ cwd: join(ROOT, "packages") })) {
    const dir = rel.replace(/\\/g, "/").split("/")[0]!;
    const pkg = (await Bun.file(join(ROOT, "packages", rel)).json()) as {
      name?: string;
      exports?: Record<string, unknown> | string;
    };
    if (!pkg.name) continue;

    const exports =
      typeof pkg.exports === "object" && pkg.exports ? pkg.exports : { ".": "./src/index.ts" };
    for (const [sub, target] of Object.entries(exports)) {
      // A subpath may be a plain string or a conditional map. `@zerotal/client`
      // is the latter — `{ browser, default }` — and skipping non-strings dropped
      // it silently, so every page importing it looked like a broken example.
      const file = resolveCondition(target);
      if (!file) continue;
      const specifier = sub === "." ? pkg.name : `${pkg.name}/${sub.replace(/^\.\//, "")}`;
      paths[specifier] = [
        "../".repeat(WORK_DEPTH + 2) + `packages/${dir}/${file.replace(/^\.\//, "")}`,
      ];
    }
  }
  return paths;
}

const TSCONFIG = {
  extends: "../".repeat(WORK_DEPTH) + "tsconfig.json", // apps/docs/tsconfig.json
  compilerOptions: {
    noEmit: true,
    emitDeclarationOnly: false,
    declaration: false,
    declarationMap: false,
    composite: false,
    incremental: false,
    sourceMap: false,
    // No DOM. These examples are Bun server code, and the browser lib was
    // answering for them: a block using `Storage.disk(...)` without an import
    // resolved to `lib.dom`'s `Storage`, so a missing import was reported as
    // "property 'disk' does not exist" — a defect in the page, apparently, rather
    // than a line it left out. `Lock` and `Cache` are browser globals too, and
    // three pages were being checked against the wrong ones.
    lib: ["ESNext"],
    types: ["bun"],
    skipLibCheck: true,
    // `noUncheckedIndexedAccess` is right for framework source and wrong here: an
    // example writing `rows[0].title` is illustrating a query, and making every
    // page add a `!` to satisfy a checker the reader's app may not even enable
    // would be the gate editing the documentation's voice.
    noUncheckedIndexedAccess: false,
    // An example imports what it is illustrating and often uses only part of it.
    // Flagging that would report a documentation style as a defect.
    noUnusedLocals: false,
    noUnusedParameters: false,
  },
  include: ["*.ts", "*.tsx"],
};

/**
 * Write `blocks` into the work directory and run tsc over exactly them.
 *
 * Every unit gets a trailing `export {}`. Without it a block that imports nothing
 * is a *script*, sharing one global scope with every other script — and two pages
 * that both open `const user = …` would collide with an error about neither of
 * them.
 */
async function runTsc(blocks: Block[]): Promise<Map<Block, string>> {
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });
  // `paths` replaces rather than merges across `extends`, so the app's own
  // mapping is folded in here instead of being silently dropped.
  const appPaths =
    (
      (await Bun.file(join(ROOT, "apps", "docs", "tsconfig.json")).json()) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      }
    ).compilerOptions?.paths ?? {};

  const config = {
    ...TSCONFIG,
    compilerOptions: {
      ...TSCONFIG.compilerOptions,
      paths: {
        ...Object.fromEntries(
          Object.entries(appPaths).map(([k, v]) => [k, v.map((t) => "../".repeat(WORK_DEPTH) + t)]),
        ),
        ...(await workspacePaths()),
      },
    },
  };
  await writeFile(join(WORK, "tsconfig.json"), JSON.stringify(config, null, 2));

  const byUnit = new Map<string, Block>();
  await Promise.all(
    blocks.map(async (b, i) => {
      const unit = `u${String(i).padStart(4, "0")}.${b.jsx || b.lang === "tsx" ? "tsx" : "ts"}`;
      byUnit.set(unit, b);
      await writeFile(join(WORK, unit), `${b.code}\nexport {};\n`, "utf8");
    }),
  );

  const proc = Bun.spawn(["bunx", "tsc", "-p", join(WORK, "tsconfig.json")], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output =
    (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  await proc.exited;

  const failures = new Map<Block, string>();
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/([\w.]+\.tsx?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.*)$/);
    if (!m) continue;
    const block = byUnit.get(m[1]!);
    if (!block || failures.has(block)) continue;
    failures.set(block, `${m[4]} ${m[5]} (example line ${m[2]})`);
  }

  await rm(WORK, { recursive: true, force: true });
  return failures;
}

/**
 * Every block tsc rejects, with its first error — in two passes, because one lies.
 *
 * When any file in a program fails to *parse*, tsc reports the syntactic errors
 * and skips semantic checking for the whole program. Compiling 1,588 blocks
 * together therefore reported the fragments' syntax errors and silently checked
 * the types of nothing: a block assigning a string to a `number` came back clean
 * while the gate said everything compiled. That is precisely the failure this
 * exists to catch, arriving as a pass.
 *
 * So: one pass finds whatever cannot parse, a second re-checks only the blocks
 * that parsed — which now form a program with no syntactic errors, so semantic
 * diagnostics actually run. Two passes are enough by construction, because the
 * first reports syntax errors program-wide and the second's input is the
 * complement of that set.
 */
async function diagnose(blocks: Block[]): Promise<Map<Block, string>> {
  if (blocks.length === 0) return new Map();

  const first = await runTsc(blocks);
  if (first.size === 0) return first;

  const parsed = blocks.filter((b) => !first.has(b));
  for (const [block, error] of await runTsc(parsed)) first.set(block, error);
  return first;
}

// ── Allowlist ─────────────────────────────────────────────────────────────────

/**
 * The four-part key: document, heading, position under it, and content hash.
 *
 * Serialised rather than joined on a separator: every field can hold the
 * character you would pick — a heading can contain a pipe, a path a space — and
 * two different fragments must never reduce to the same key.
 */
const keyOf = (e: Entry | Block): string => JSON.stringify([e.file, e.heading, e.ordinal, e.hash]);

const entryOf = (b: Block): Entry => ({
  file: b.file,
  heading: b.heading,
  ordinal: b.ordinal,
  hash: b.hash,
});

/**
 * Two lists, because there are two reasons a block does not compile and only one
 * of them is acceptable.
 *
 * `fragments` are intentional: a class body, a set of columns, a method shown
 * without its class. They are exempt, and the author said so in the fence.
 *
 * `drift` is the other kind — a block that resolves everything and still fails.
 * A member that no longer exists, an argument the signature stopped taking, an
 * index a reader's strict app would refuse. Those are defects, and recording them
 * as fragments would certify broken documentation as intentional. They get their
 * own name so the list reads as what it is: work outstanding.
 *
 * Both are keyed and neither may grow. `drift` is expected to reach zero.
 */
interface Baseline {
  note: string;
  fragments: Entry[];
  drift: Entry[];
}

async function readBaseline(): Promise<Baseline> {
  const file = Bun.file(BASELINE);
  if (!(await file.exists())) return { note: "", fragments: [], drift: [] };
  const data = (await file.json()) as Partial<Baseline>;
  return { note: data.note ?? "", fragments: data.fragments ?? [], drift: data.drift ?? [] };
}

const NOTE =
  "Documentation examples that do not compile on their own, keyed by document, heading, " +
  "position under that heading, and a hash of the normalised source. `fragments` are " +
  "deliberate — a class body, a method without its class — and say so in the fence. " +
  "`drift` is not: those blocks resolve everything and still fail, which means the " +
  "documentation is wrong and the entry is a defect waiting to be fixed. Generated by " +
  "`bun run docs:examples`. Neither list may grow.";

const NEWLINE = String.fromCharCode(10);

const byPosition = (a: Entry, b: Entry): number =>
  a.file.localeCompare(b.file) || a.heading.localeCompare(b.heading) || a.ordinal - b.ordinal;

async function writeBaseline(fragments: Entry[], drift: Entry[]): Promise<void> {
  const body = {
    note: NOTE,
    fragments: [...fragments].sort(byPosition),
    drift: [...drift].sort(byPosition),
  };
  await writeFile(BASELINE, JSON.stringify(body, null, 2) + NEWLINE, "utf8");
}

// ── Seeding (one-time) ────────────────────────────────────────────────────────

/**
 * Error codes that mean "this block is not a whole program", as opposed to
 * "this block is wrong".
 *
 * The distinction is the whole value of the exercise. A block that cannot parse,
 * names something it never defines, or imports a file belonging to the reader's
 * imaginary app is a fragment — the compiler is describing its *shape*. A block
 * that resolves everything and still fails is documentation that has drifted: a
 * member that no longer exists, an argument the signature stopped accepting.
 *
 * Seeding on this set rather than on "everything that fails" is what keeps the
 * second kind out of the allowlist, where an exemption would certify a broken
 * example as intentional. Those are listed for a human instead.
 *
 * This is not the gate inferring fragments — the gate never infers. It is the
 * one-time migration choosing what to propose, on the compiler's evidence, in a
 * diff someone reads.
 */
const STRUCTURAL = new Set([
  "TS2304", // Cannot find name — references something it does not define.
  "TS2307", // Cannot find module — an import from an app that does not exist here.
  "TS2593", // Cannot find name 'test' — same, for a test runner's globals.
  "TS2391", // Function implementation missing — a signature shown on its own.
  "TS2657", // JSX expressions must have one parent — sibling elements, no wrapper.
  "TS1108", // A return statement outside a function — a method body on its own.
  "TS2552", // Cannot find name X, did you mean Y — TS2304 with a suggestion attached.
  "TS18004", // Shorthand property with no value in scope — names it does not define.
  "TS2515", // Does not implement an inherited abstract member — a partial class.
  "TS2390", // Constructor implementation missing — signatures shown without a body.
  "TS2395", // Merged declaration must be all exported or all local — half a pair.
]);

/**
 * Whether `error` describes the block's shape rather than a defect in it.
 *
 * `code` is consulted for one case the error text cannot settle on its own.
 * `this` at the top level of a module is `undefined` under `strict`, so a method
 * body shown without its class — `this.info("Success")`, under a comment reading
 * "inside a command's run()" — reports as `Object is possibly 'undefined'`. That
 * is the block's shape, not a nullable value the page got wrong. The test is
 * `this.` at column zero: inside a class or a function it would be indented.
 */
function isStructural(error: string, code: string): boolean {
  // TS1xxx is the parser and TS17xxx is the JSX parser; both describe a block that
  // does not parse, which is the plainest statement of "not a whole program".
  const id = error.slice(0, error.indexOf(" "));
  if (STRUCTURAL.has(id) || /^TS1(\d{3}|7\d{3})$/.test(id)) return true;
  return (id === "TS2532" || id === "TS2531") && /^this\./m.test(code);
}

/**
 * Mark every block that does not compile with the `fragment` token.
 *
 * Run once, when the gate lands, and reviewed as a diff. The criterion is the
 * compiler's answer, not a guess about what the block looks like — which is the
 * one basis on which marking en masse is honest.
 */
async function seed(blocks: Block[], failures: Map<Block, string>): Promise<number> {
  const byFile = new Map<string, Block[]>();
  for (const b of blocks) {
    const error = failures.get(b);
    if (!error || b.fragment || !isStructural(error, b.code)) continue;
    const list = byFile.get(b.file) ?? [];
    list.push(b);
    byFile.set(b.file, list);
  }

  let marked = 0;
  for (const [file, list] of byFile) {
    const path = join(ROOT, file);
    const lines = (await Bun.file(path).text()).replace(/\r\n?/g, "\n").split("\n");
    // Descending, so an edit never moves a line another edit is waiting on.
    for (const b of [...list].sort((x, y) => y.line - x.line)) {
      const idx = b.line - 1;
      const line = lines[idx];
      if (!line || !/^\s*`{3,}/.test(line)) continue;
      lines[idx] = `${line.trimEnd()} ${FRAGMENT_TOKEN}`;
      marked++;
    }
    await writeFile(path, lines.join("\n"), "utf8");
  }
  return marked;
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = new Set(Bun.argv.slice(2));
const check = args.has("--check");

const blocks = await collect();
if (blocks.length === 0) {
  console.error("No TypeScript examples found — is docs/ where it should be?");
  process.exit(1);
}

// Separate programs on purpose: fragments do not parse, and a program containing
// one is a program whose types go unchecked.
const fragments = blocks.filter((b) => b.fragment);
const whole = blocks.filter((b) => !b.fragment);

const wholeFailures = await diagnose(whole);

if (args.has("--seed")) {
  const marked = await seed(blocks, wholeFailures);
  const real = [...wholeFailures].filter(([b, e]) => !isStructural(e, b.code));
  console.log(`Marked ${marked} block(s) as fragments.`);
  if (real.length) {
    console.log(`
${real.length} block(s) resolve everything and still fail — documentation, not shape:
`);
    for (const [b, e] of real) console.log(`  ${b.file}:${b.line}  ${e}`);
  }
  process.exit(0);
}

// A block the author called a fragment that compiles on its own is not one, and
// leaving it marked exempts a block nothing needs to exempt.
const fragmentFailures = await diagnose(fragments);
const compilable = fragments.filter((b) => !fragmentFailures.has(b));
const recorded = fragments.filter((b) => fragmentFailures.has(b));

// Unmarked blocks that fail are the corpus's outstanding defects: they resolve
// their imports and still do not compile, which is the definition of drift.
const drifted = whole.filter((b) => wholeFailures.has(b));

if (!check) {
  await writeBaseline(recorded.map(entryOf), drifted.map(entryOf));
  console.log(
    `✓ ${blocks.length} example(s): ${whole.length - drifted.length} compile, ` +
      `${recorded.length} marked fragment(s), ${drifted.length} recorded as drift` +
      (compilable.length ? `, ${compilable.length} no longer need the exemption` : ""),
  );
  process.exit(0);
}

const baseline = await readBaseline();

const knownFragments = new Set(baseline.fragments.map(keyOf));
const knownDrift = new Set(baseline.drift.map(keyOf));
const presentFragments = new Set(recorded.map(keyOf));
const presentDrift = new Set(drifted.map(keyOf));

const newFragments = recorded.filter((b) => !knownFragments.has(keyOf(b)));
const newDrift = drifted.filter((b) => !knownDrift.has(keyOf(b)));
const staleFragments = baseline.fragments.filter((e) => !presentFragments.has(keyOf(e)));
const fixedDrift = baseline.drift.filter((e) => !presentDrift.has(keyOf(e)));

const problems: string[] = [];

if (newDrift.length) {
  for (const b of newDrift) problems.push(`  ${b.file}:${b.line}  ${wholeFailures.get(b)}`);
  problems.push(
    `
  ${newDrift.length} example(s) above do not compile and are not recorded. Fix them,` +
      `
  or — if the block is deliberately not a whole program — write \`${FRAGMENT_TOKEN}\`` +
      `
  in its fence. Run \`bun run docs:examples\` either way.
`,
  );
}

if (newFragments.length) {
  for (const b of newFragments)
    problems.push(`  ${b.file}:${b.line}  new fragment, not in the allowlist`);
  problems.push(
    `
  ${newFragments.length} fragment(s) are not recorded. Adding one is a deliberate act:` +
      `
  run \`bun run docs:examples\` and commit the allowlist alongside the page.
`,
  );
}

if (compilable.length) {
  for (const b of compilable)
    problems.push(`  ${b.file}:${b.line}  marked \`${FRAGMENT_TOKEN}\`, but compiles`);
  problems.push(
    `
  ${compilable.length} block(s) no longer need the exemption. Drop the token and run` +
      `
  \`bun run docs:examples\`.
`,
  );
}

for (const [label, entries, hint] of [
  ["fragment", staleFragments, "review what moved"],
  ["drift", fixedDrift, "these are fixed — the list should shrink"],
] as const) {
  if (!entries.length) continue;
  for (const e of entries) {
    problems.push(
      `  ${e.file} (${e.heading || "top"} #${e.ordinal})  ${label} entry matches nothing`,
    );
  }
  problems.push(
    `
  ${entries.length} ${label} entr(ies) point at a block that has changed or gone.` +
      `
  Run \`bun run docs:examples\` — ${hint}.
`,
  );
}

if (problems.length) {
  console.error(problems.join(NEWLINE));
  process.exit(1);
}

console.log(
  `✓ ${blocks.length} documentation example(s) checked: ${whole.length - drifted.length} compile, ` +
    `${recorded.length} marked fragment(s), ${drifted.length} known drift.`,
);
