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

async function main(): Promise<void> {
  printBanner();

  // ── Project name ────────────────────────────────────────────────────────────
  const nameArg = process.argv[2]?.trim() ?? '';
  const name    = nameArg
    || await ask('Project name', 'my-zerotal-app');

  const target = resolve(process.cwd(), name);

  // Guard: don't overwrite an existing non-empty directory
  const existing = await Bun.file(target + '/package.json').exists();
  if (existing) {
    warn(`Directory already contains a package.json — aborting to avoid overwrite.`);
    process.exit(1);
  }

  // ── Template ────────────────────────────────────────────────────────────────
  log('');
  const template = await choose<Template>('Template', [
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
  let db: Database = 'sqlite';
  if (template === 'api') {
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
  step(`Scaffolding ${c.bold}${name}${c.reset} (${template})…`);

  await scaffold({ name, template, db, target });
  info(`Project files created`);

  // ── Install ─────────────────────────────────────────────────────────────────
  log('');
  step('Installing dependencies…');
  const ok = await install(target);
  if (ok) {
    info(`Dependencies installed`);
  } else {
    warn(`bun install failed — run it manually inside the project`);
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  log('');
  log(`${c.green}${c.bold}  ✓ Done!${c.reset}`);
  log('');
  log(`${c.bold}  Next steps:${c.reset}`);
  dim(`cd ${name}`);
  if (template === 'api') {
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
  log(`${c.gray}  Docs: https://zerotal.dev${c.reset}`);
  log('');
}

main().catch((err: unknown) => {
  process.stderr.write(`\x1b[31mError: ${(err as Error).message}\x1b[0m\n`);
  process.exit(1);
});
