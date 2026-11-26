import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { gettingStarted } from './steps.ts';

export type Database = 'sqlite' | 'postgres' | 'mysql';
export type Template = 'minimal' | 'api' | 'admin' | 'flow' | 'react' | 'vue';

// Version range stamped into scaffolded apps' `zerotal` / `@zerotal/*` dependencies.
//
// This must match the version this package is published at: the monorepo releases
// in lockstep, so a `create-zerotal@X.Y.Z` that scaffolds any other range points
// new projects at packages that need not exist. When it drifted to `^1.1.0` while
// the registry held 1.0.0, every scaffold ended in `error: No version matching
// "^1.1.0" found for specifier "zerotal"` — the first thing anyone trying the
// framework saw. `scaffold.test.ts` now asserts the two agree, so CI fails rather
// than the user's install.
//
// The range is a tilde, not a caret, on purpose. Under the versioning scheme in
// `docs/upgrade.md` a minor is where a break lands, so `^X.Y.Z` would let a new
// app take the next minor and its breaking change on the next install, unread.
// `~X.Y.Z` takes every patch (fixes and features) and stops at the minor, which the
// app then crosses deliberately. The docs already call a tilde the right default;
// this is the tool following its own advice.
export const ZT_VERSION = "~1.17.4";

export interface ScaffoldOptions {
  name:     string;
  template: Template;
  db:       Database;
  target:   string; // absolute path of the new project directory
  /**
   * Ship the coding-agent files (see {@link AGENT_PATHS}). On unless declined with
   * `--no-agent`.
   */
  agent?:   boolean;
}

/**
 * What a starter carries for coding agents, by output path.
 *
 * `AGENTS.md` and its `CLAUDE.md` import, the MCP server registration, the skills, and
 * the provider that keeps them current — `bun zt arch:update` after an upgrade, and a
 * `doctor` warning when they drift. Each one is generated from the starter by
 * `bun run starters:agent`, which is what `arch:update` itself would write there, so a
 * new app's first update has nothing to change.
 *
 * A directory entry ends in `/` and covers everything under it. `--no-agent` leaves all
 * of these out, and `@zerotal/arch` with them.
 */
export const AGENT_PATHS: readonly string[] = [
  'AGENTS.md',
  'CLAUDE.md',
  '.mcp.json',
  '.agents/',
  '.claude/',
  '.vscode/mcp.json',
  'app/providers/ArchProvider.ts',
];

/** The package the agent files belong to, removed from `package.json` with them. */
export const AGENT_PACKAGE = '@zerotal/arch';

/** Whether a file at this output path is one of the {@link AGENT_PATHS}. */
export function isAgentPath(path: string): boolean {
  return AGENT_PATHS.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
}

// ── Token map ─────────────────────────────────────────────────────────────────

function randomBase64(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64');
}

/**
 * What the secrets read as in the committed `.env.example`.
 *
 * A value nobody could mistake for a working key, and one that names the command
 * that produces a real one. `.env` still gets a freshly generated key, so a new
 * app boots immediately — the example is the copy that goes to a git host.
 */
const PLACEHOLDER_SECRETS: Record<string, string> = {
  '{{app_key}}':        'run-`bun zt.ts key:generate`-to-fill-this',
  '{{session_secret}}': 'run-`bun zt.ts key:generate`-to-fill-this',
};

function tokens(opts: ScaffoldOptions): Record<string, string> {
  const dbUrl: Record<Database, string> = {
    sqlite:   './database/db.sqlite',
    postgres: 'postgres://localhost/{{name}}',
    mysql:    'mysql://root@localhost/{{name}}',
  };

  return {
    '{{name}}':            opts.name,
    '{{db_url}}':          dbUrl[opts.db].replace('{{name}}', opts.name),
    '{{app_key}}':         randomBase64(32),
    '{{session_secret}}':  randomBase64(32),
    '{{db_driver}}':       opts.db,
    '{{zerotal_version}}':  ZT_VERSION,
    '{{getting_started}}':  gettingStarted(opts.template, opts.db),
  };
}

function applyTokens(content: string, map: Record<string, string>): string {
  let out = content;
  for (const [token, value] of Object.entries(map)) {
    out = out.replaceAll(token, value);
  }
  return out;
}

// ── Output paths ──────────────────────────────────────────────────────────────

/**
 * Template files stored under another name, and the name each is written as.
 *
 * A dotfile does not survive publishing: `bun pm pack` and npm leave some out of the
 * package, and Bun's glob skips them when the templates are scanned. So each is stored
 * with a leading underscore and renamed here — `_gitignore` → `.gitignore`. Directories
 * are covered too (`_github/` → `.github/`), for the CI workflow inside one.
 *
 * `bunfig.toml` is not a dotfile, but `bun pm pack` leaves it out of a package as well,
 * so 1.15.5 shipped its starters without one; it is `_bunfig.toml` for the same reason.
 *
 * `scaffold.test.ts` packs this package and checks every name here arrives.
 */
export const RENAMED: Readonly<Record<string, string>> = {
  _gitignore: '.gitignore',
  '_env.example': '.env.example',
  '_bunfig.toml': 'bunfig.toml',
  _dockerignore: '.dockerignore',
  _editorconfig: '.editorconfig',
  '_prettierrc.json': '.prettierrc.json',
  _prettierignore: '.prettierignore',
  _github: '.github',
  _vscode: '.vscode',
  _agents: '.agents',
  _claude: '.claude',
  '_mcp.json': '.mcp.json',
};

/**
 * Where a template file is written, relative to the new project.
 *
 * The first path segment is renamed per {@link RENAMED}. Test files carry a trailing
 * `.tmpl` that is stripped, so Bun does not discover them while this package is developed
 * inside the monorepo — where their `zerotal/testing` imports cannot resolve, because they
 * are written for the app being scaffolded rather than for this workspace. The previous
 * spelling was `_test.ts`, which does not work: Bun's matcher globs `_test.ts` as readily
 * as `.test.ts` (and `.spec.ts` / `_spec.ts`), so those files were collected and failed on
 * every root `bun test`. A trailing suffix is matched by none of them.
 */
export function outputPath(rel: string): string {
  const [first = '', ...rest] = rel.replace(/\\/g, '/').split('/');
  return [RENAMED[first] ?? first, ...rest].join('/').replace(/\.tmpl$/, '');
}

// ── File walker ───────────────────────────────────────────────────────────────

async function* walk(dir: string): AsyncGenerator<string> {
  const glob = new Bun.Glob('**/*');
  for await (const rel of glob.scan({ cwd: dir, onlyFiles: true })) {
    yield rel;
  }
}

// ── Scaffold ──────────────────────────────────────────────────────────────────

export async function scaffold(opts: ScaffoldOptions): Promise<void> {
  const templatesRoot = join(import.meta.dir, '..', 'templates');
  const templateDir   = join(templatesRoot, opts.template);
  const map           = tokens(opts);

  const agent         = opts.agent !== false;

  for await (const rel of walk(templateDir)) {
    const out  = outputPath(rel);
    if (!agent && isAgentPath(out)) continue;

    const src  = join(templateDir, rel);
    const dest = join(opts.target, out);

    await mkdir(dirname(dest), { recursive: true });

    const raw     = await Bun.file(src).text();
    let content   = applyTokens(raw, map);
    if (!agent && out === 'package.json') content = withoutDependency(content, AGENT_PACKAGE);
    await Bun.write(dest, content);

    // `.env` gets the real secrets; `.env.example` gets placeholders.
    //
    // Both used to get the same rendered content, which put a live, working
    // APP_KEY into the one file of the pair that `.gitignore` does *not* cover.
    // Every scaffolded project therefore committed its own session-signing key,
    // and `cp .env.example .env` — the first line of every deployment guide there
    // is — carried that published key into production. One key across a laptop
    // and a server is one compromise across both, and a strength check cannot
    // catch it: as a string the value is perfectly strong. The problem is that
    // this particular value was distributed.
    if (dest.endsWith('.env.example')) {
      await Bun.write(dest.replace(/\.env\.example$/, '.env'), content);
      await Bun.write(dest, applyTokens(raw, { ...map, ...PLACEHOLDER_SECRETS }));
    }
  }

  await writeGitAttributes(opts.target);
}

/**
 * `package.json` text without one dependency.
 *
 * Parsed and rewritten rather than edited as text: a line-based edit leaves the comma of
 * the entry before it dangling whenever the removed one was last.
 */
function withoutDependency(manifest: string, name: string): string {
  const parsed = JSON.parse(manifest) as Record<string, unknown>;
  for (const key of ['dependencies', 'devDependencies']) {
    const deps = parsed[key];
    if (deps && typeof deps === 'object') delete (deps as Record<string, unknown>)[name];
  }
  return JSON.stringify(parsed, null, 2) + '\n';
}

/**
 * Pin line endings to LF.
 *
 * On Windows, git's default `autocrlf` rewrites every checkout to CRLF and prints `LF will be
 * replaced by CRLF the next time Git touches it` for each generated file, every commit, forever:
 * `types/routes.generated.ts`, `resources/js/pages.generated.ts` and anything the framework
 * scaffolds later. The files are LF on the server they are deployed to, so a CRLF working copy is
 * only ever noise, and a formatter that disagrees with it is the next thing to go wrong.
 *
 * `text=auto` leaves binary files alone. Written for every template rather than shipped in each,
 * so there is one copy to keep right.
 */
async function writeGitAttributes(target: string): Promise<void> {
  const path = join(target, '.gitattributes');
  // An app that already has one has decided; a template that ships its own wins.
  if (await Bun.file(path).exists()) return;
  await Bun.write(path, '# Line endings are LF everywhere, on every machine.\n* text=auto eol=lf\n');
}

// ── Install ───────────────────────────────────────────────────────────────────

export async function install(cwd: string): Promise<boolean> {
  const proc = Bun.spawn(['bun', 'install'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  return code === 0;
}
