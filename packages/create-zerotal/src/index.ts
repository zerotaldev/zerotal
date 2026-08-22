#!/usr/bin/env bun
/**
 * create-zerotal — Zerotal application scaffolder
 *
 * Usage:
 *   bun create zerotal my-app
 *   bunx create-zerotal my-app
 */

import { resolve } from 'node:path';
import { printBanner, ask, choose, log, info, warn, step, dim, c } from './prompts.ts';
import { scaffold, install, type Template, type Database } from './scaffold.ts';
import { parseArgs, resolveOptions, helpText, TEMPLATES, DATABASES } from './args.ts';
import { newerScaffolderVersion } from './staleness.ts';

/** This scaffolder's own version, read from the manifest that ships beside it. */
const ZT_SELF_VERSION: string = (
  (await Bun.file(new URL('../package.json', import.meta.url)).json()) as { version: string }
).version;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(helpText() + '\n');
    return;
  }
  if (args.version) {
    process.stdout.write(ZT_SELF_VERSION + '\n');
    return;
  }

  // Whether there is anybody to answer a question. Without this the prompts'
  // readline waits on a line that never comes, so a scaffolder run in CI or by
  // an agent did not fail — it hung until something killed it.
  const interactive = Boolean(process.stdin.isTTY);
  const plan = resolveOptions(args, interactive);
  if (!plan.ok) {
    process.stderr.write(`\x1b[31mError: ${plan.error}\x1b[0m\n\n${helpText()}\n`);
    process.exit(1);
  }
  const asking = new Set(plan.askFor ?? []);

  // Started before the banner and awaited after the prompts, so the check costs
  // no perceived time at all — the answer arrives while a human is reading.
  const newerScaffolder = newerScaffolderVersion(ZT_SELF_VERSION);

  printBanner();

  // ── Project name ────────────────────────────────────────────────────────────
  const name = asking.has('name')
    ? await ask('Project name', 'my-zerotal-app')
    : plan.name!;

  const target = resolve(process.cwd(), name);

  // Guard: don't overwrite an existing non-empty directory
  const existing = await Bun.file(target + '/package.json').exists();
  if (existing) {
    warn(`Directory already contains a package.json — aborting to avoid overwrite.`);
    process.exit(1);
  }

  // ── Template ────────────────────────────────────────────────────────────────
  log('');
  const template: Template = !asking.has('template')
    ? plan.template!
    : await choose<Template>('Template', [
    {
      value:       'api',
      label:       'API',
      description: 'JSON REST API — core, ORM, auth, validation, testing',
    },
    {
      value:       'admin',
      label:       'Admin',
      description: 'Admin panel — resources, auth, dashboard widgets, seeded demo data',
    },
    {
      value:       'flow',
      label:       'Flow',
      description: 'Server-driven UI — Flow pages, top nav, Tailwind',
    },
    {
      value:       'react',
      label:       'React',
      description: 'Inertia + React SPA — file-based routes, Tailwind',
    },
    {
      value:       'vue',
      label:       'Vue',
      description: 'Inertia + Vue SPA — file-based routes, Tailwind',
    },
    {
      value:       'minimal',
      label:       'Minimal',
      description: 'Single page, JSX views, Tailwind — bare framework',
    },
  ]);

  // ── Database ─────────────────────────────────────────────────────────────────
  // Only the API template ships a database config; minimal/flow have no DB.
  let db: Database = plan.db ?? 'sqlite';
  if (template === 'api' && asking.has('db')) {
    log('');
    db = await choose<Database>('Database', [
      {
        value:       'sqlite',
        label:       'SQLite',
        description: 'Zero setup, file-based — great for getting started',
      },
      {
        value:       'postgres',
        label:       'PostgreSQL',
        description: 'Requires DATABASE_URL env var',
      },
      {
        value:       'mysql',
        label:       'MySQL',
        description: 'Requires DATABASE_URL env var',
      },
    ]);
  }

  // ── Scaffold ────────────────────────────────────────────────────────────────
  log('');

  // Answered by now: the request went out before the first prompt, and the
  // prompts take human time. Said before anything is written, so re-running with
  // the current scaffolder costs nothing but a Ctrl-C.
  const newer = await newerScaffolder;
  if (newer) {
    warn(`This scaffolder is ${ZT_SELF_VERSION}; ${newer} is published.`);
    dim(`A cached copy stamps the dependency ranges it shipped with, so a new`);
    dim(`project can be created against versions that are no longer current.`);
    dim(`${c.bold}bunx create-zerotal@latest ${name}${c.reset}${c.gray} always fetches the published one.`);
    log('');
  }

  step(`Scaffolding ${c.bold}${name}${c.reset} (${template})…`);

  await scaffold({ name, template, db, target });
  info(`Project files created`);

  // ── Install ─────────────────────────────────────────────────────────────────
  if (plan.install !== false) {
    log('');
    step('Installing dependencies…');
    const ok = await install(target);
    if (ok) {
      info(`Dependencies installed`);
    } else {
      warn(`bun install failed — run it manually inside the project`);
      // A failed install is a broken project, and a script that carried on
      // regardless would report success for one. A human has the message above
      // and the directory in front of them; CI needs the exit code.
      if (!interactive) process.exit(1);
    }
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  log('');
  log(`${c.green}${c.bold}  ✓ Done!${c.reset}`);
  log('');
  log(`${c.bold}  Next steps:${c.reset}`);
  dim(`cd ${name}`);
  // Every template that ships baseline migrations builds its schema from them
  // (synchronize is off), so the first migrate is a required step, not a tip.
  if (template === 'api' || template === 'flow' || template === 'react' || template === 'vue') {
    if (db !== 'sqlite') {
      dim(`# Set DATABASE_URL in .env`);
    }
    dim(`bun zt migrate`);
  }
  if (template === 'admin') {
    // The panel is behind a sign-in, so the demo data (which includes the first
    // account) is what makes a fresh app usable rather than a locked door.
    dim(`bun zt db:seed              # demo data + admin@example.com / password`);
  }
  dim(`bun zt serve --dev`);
  if (template === 'admin') {
    dim(`# then open http://localhost:3000/admin`);
  }
  log('');
  // Discoverability without a dependency. `@zerotal/arch` exposes the app's own
  // routes, schema and docs to a coding agent over MCP, and it is genuinely
  // useful — but it is `beta`, and putting a beta package in every template would
  // undercut the maturity rule the packages gate enforces. `arch:install` also
  // writes `.mcp.json` and instruction files into the project, which is an
  // opinion about someone's toolchain and should stay their choice.
  log(`${c.gray}  Agent tooling (optional): bun add -d @zerotal/arch && bun zt arch:install${c.reset}`);
  log('');
  log(`${c.gray}  Docs: https://zerotal.dev${c.reset}`);
  log('');
}

main().catch((err: unknown) => {
  process.stderr.write(`\x1b[31mError: ${(err as Error).message}\x1b[0m\n`);
  process.exit(1);
});
