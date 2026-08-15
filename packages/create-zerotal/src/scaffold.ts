import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

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
export const ZT_VERSION = "^1.6.3";

export interface ScaffoldOptions {
  name:     string;
  template: Template;
  db:       Database;
  target:   string; // absolute path of the new project directory
}

// ── Token map ─────────────────────────────────────────────────────────────────

function randomBase64(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64');
}

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
  };
}

function applyTokens(content: string, map: Record<string, string>): string {
  let out = content;
  for (const [token, value] of Object.entries(map)) {
    out = out.replaceAll(token, value);
  }
  return out;
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

  for await (const rel of walk(templateDir)) {
    const src  = join(templateDir, rel);
    // Rename underscore-prefixed dotfiles — npm and Bun glob both skip real dotfiles
    // inside published/scanned directories. _gitignore → .gitignore, etc.
    //
    // Test files carry a trailing `.tmpl` that is stripped here, so Bun does not
    // discover them while this package is developed inside the monorepo — where their
    // `zerotal/testing` imports cannot resolve, because they are written for the app
    // being scaffolded rather than for this workspace. The previous spelling was
    // `_test.ts`, which does not work: Bun's matcher globs `_test.ts` as readily as
    // `.test.ts` (and `.spec.ts` / `_spec.ts`), so those files were collected and failed
    // on every root `bun test`. A trailing suffix is matched by none of them.
    const dest = join(opts.target, rel
      .replace('_gitignore',   '.gitignore')
      .replace('_env.example', '.env.example')
      .replace(/\.tmpl$/,      ''),
    );

    await mkdir(dirname(dest), { recursive: true });

    const raw     = await Bun.file(src).text();
    const content = applyTokens(raw, map);
    await Bun.write(dest, content);

    // Also write a ready-to-run `.env` next to `.env.example`. The example
    // already carries a freshly-generated APP_KEY/SESSION_SECRET, so a fresh
    // app boots immediately without a manual `cp .env.example .env` +
    // `key:generate` step (the old flow left APP_KEY empty on first boot).
    if (dest.endsWith('.env.example')) {
      await Bun.write(dest.replace(/\.env\.example$/, '.env'), content);
    }
  }
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
