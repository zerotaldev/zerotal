import type { Database, Template } from './scaffold.ts';

export const TEMPLATES: readonly Template[] = ['api', 'admin', 'flow', 'react', 'vue', 'minimal'];
export const DATABASES: readonly Database[] = ['sqlite', 'postgres', 'mysql'];

/** Defaults, matching the first option of each prompt. */
export const DEFAULT_TEMPLATE: Template = 'api';
export const DEFAULT_DATABASE: Database = 'sqlite';

export interface ParsedArgs {
  name?: string;
  template?: string;
  db?: string;
  /** Take defaults for anything not supplied, instead of asking. */
  yes: boolean;
  install: boolean;
  help: boolean;
  version: boolean;
  /** Flags that are not ours — reported rather than ignored. */
  unknown: string[];
}

/**
 * Parse the command line.
 *
 * Supports `--flag value` and `--flag=value`, plus `-t`/`-y`/`-h` shorthands, so
 * neither habit is wrong. The first non-flag argument is the project name, which
 * keeps `bun create zerotal my-app` working exactly as before.
 *
 * Unknown flags are collected rather than dropped. Silently ignoring
 * `--tempalte=api` and then interactively asking for the template is the worst
 * of both worlds: in CI it hangs, and a human is asked a question they thought
 * they had answered.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { yes: false, install: true, help: false, version: false, unknown: [] };
  const takesValue = new Set(['name', 'template', 'db', 't']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (!arg.startsWith('-')) {
      out.name ??= arg;
      continue;
    }

    const [rawKey, inlineValue] = arg.replace(/^--?/, '').split(/=(.*)/s, 2) as [string, string?];
    const key = rawKey === 't' ? 'template' : rawKey === 'y' ? 'yes' : rawKey === 'h' ? 'help' : rawKey;

    // `--no-install` — the standard spelling for negating a boolean flag.
    if (key === 'no-install') {
      out.install = false;
      continue;
    }
    if (key === 'yes') {
      out.yes = true;
      continue;
    }
    if (key === 'help') {
      out.help = true;
      continue;
    }
    if (key === 'version' || key === 'v') {
      out.version = true;
      continue;
    }

    if (takesValue.has(key === 'template' ? 'template' : key)) {
      // `--template api` as well as `--template=api`; a following flag is not a
      // value, so `--template --yes` is a missing value rather than the string
      // "--yes".
      const next = argv[i + 1];
      const value = inlineValue ?? (next && !next.startsWith('-') ? (i++, next) : undefined);
      // Assigned only when present: `exactOptionalPropertyTypes` treats an
      // explicit `undefined` as different from an absent key, and "absent" is
      // exactly what a flag with no value means.
      if (value !== undefined) {
        if (key === 'name') out.name = value;
        else if (key === 'template') out.template = value;
        else if (key === 'db') out.db = value;
      }
      continue;
    }

    out.unknown.push(arg);
  }

  return out;
}

export interface Resolution {
  ok: boolean;
  /** Populated when `ok` — everything the scaffolder needs. */
  name?: string | undefined;
  template?: Template | undefined;
  db?: Database | undefined;
  install?: boolean | undefined;
  /** Questions still to ask. Empty in non-interactive mode. */
  askFor?: Array<'name' | 'template' | 'db'>;
  /** Populated when `!ok` — a message a human or a CI log can act on. */
  error?: string;
}

/**
 * Turn parsed flags into either a plan or a refusal.
 *
 * The rule that matters: **never wait on stdin that is not there.** Without a
 * TTY the prompts' `readline` never receives a line, so the old scaffolder did
 * not fail in CI — it hung, forever, holding the job open until the runner timed
 * it out. A missing answer is now an error with the flag that would have
 * supplied it.
 *
 * `--yes` takes the defaults for whatever is unspecified, which is what makes
 * the tool scriptable in one word.
 */
export function resolveOptions(args: ParsedArgs, interactive: boolean): Resolution {
  if (args.unknown.length) {
    return { ok: false, error: `Unknown option${args.unknown.length > 1 ? 's' : ''}: ${args.unknown.join(', ')}` };
  }

  if (args.template !== undefined && !TEMPLATES.includes(args.template as Template)) {
    return { ok: false, error: `Unknown template "${args.template}". Choose one of: ${TEMPLATES.join(', ')}` };
  }
  if (args.db !== undefined && !DATABASES.includes(args.db as Database)) {
    return { ok: false, error: `Unknown database "${args.db}". Choose one of: ${DATABASES.join(', ')}` };
  }

  const template = (args.template as Template | undefined);
  const db = (args.db as Database | undefined);

  if (interactive && !args.yes) {
    const askFor: Array<'name' | 'template' | 'db'> = [];
    if (!args.name) askFor.push('name');
    if (!template) askFor.push('template');
    // Only the API template offers a database choice; the rest have no DB config.
    if (!db && (template === undefined || template === 'api')) askFor.push('db');
    return { ok: true, name: args.name, template, db, install: args.install, askFor };
  }

  // Non-interactive from here: everything must already be known, or defaulted.
  if (!args.name) {
    return {
      ok: false,
      error:
        'A project name is required when there is no terminal to ask on.\n' +
        '  bunx create-zerotal my-app --template=api --yes',
    };
  }
  if (!template && !args.yes) {
    return {
      ok: false,
      error:
        'No template given, and no terminal to ask on.\n' +
        `  Pass --template=<${TEMPLATES.join('|')}>, or --yes to take the default (${DEFAULT_TEMPLATE}).`,
    };
  }

  const chosen = template ?? DEFAULT_TEMPLATE;
  return {
    ok: true,
    name: args.name,
    template: chosen,
    db: chosen === 'api' ? (db ?? DEFAULT_DATABASE) : DEFAULT_DATABASE,
    install: args.install,
    askFor: [],
  };
}

/** The `--help` text. */
export function helpText(): string {
  return [
    'create-zerotal — scaffold a Zerotal application',
    '',
    'Usage',
    '  bun create zerotal <name> [options]',
    '  bunx create-zerotal <name> [options]',
    '',
    'Options',
    `  -t, --template <name>  ${TEMPLATES.join(' | ')}`,
    `      --db <name>        ${DATABASES.join(' | ')} (api template only)`,
    '  -y, --yes              Take defaults for anything not given; never prompt',
    '      --no-install       Skip bun install',
    '  -h, --help             Show this message',
    '  -v, --version          Print the scaffolder version',
    '',
    'Non-interactive',
    '  With no TTY (CI, an agent, a pipe) the scaffolder never prompts. Supply the',
    '  answers as flags, or pass --yes to take the defaults.',
    '',
    '  bunx create-zerotal my-app --template=api --db=postgres --yes',
  ].join('\n');
}
