import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { scaffold, type Database, type Template } from './scaffold.ts';
import { nextStepLines } from './steps.ts';
import { TEMPLATES } from './args.ts';

const TMP = join(import.meta.dir, '..', '.test-output');
const TEMPLATES_DIR = join(import.meta.dir, '..', 'templates');

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

// ── what the terminal prints ─────────────────────────────────────────────────

describe('nextStepLines', () => {
  it('minimal has no database, so nothing to run before the dev server', () => {
    expect(nextStepLines('app', 'minimal', 'sqlite')).toEqual(['cd app', 'bun zt dev']);
  });

  it.each(['flow', 'react', 'vue', 'api'] as const)('%s migrates first', (template) => {
    expect(nextStepLines('app', template, 'sqlite')).toEqual([
      'cd app',
      'bun zt migrate',
      'bun zt dev',
    ]);
  });

  it('a non-sqlite database is told where its URL goes before migrating', () => {
    expect(nextStepLines('app', 'api', 'postgres')).toEqual([
      'cd app',
      '# Set DATABASE_URL in .env',
      'bun zt migrate',
      'bun zt dev',
    ]);
  });

  it('admin seeds its demo account, then says where the panel is', () => {
    expect(nextStepLines('app', 'admin', 'sqlite')).toEqual([
      'cd app',
      'bun zt db:seed              # demo data + admin@example.com / password',
      'bun zt dev',
      '# then open http://localhost:3000/admin',
    ]);
  });
});

// ── what the README says ─────────────────────────────────────────────────────

/** The commands in the README's first fenced bash block. */
async function readmeCommands(): Promise<string[]> {
  const readme = await Bun.file(join(TMP, 'README.md')).text();
  const block = readme.match(/## Getting started\n\n```bash\n([\s\S]*?)\n```/);
  if (!block) throw new Error('no "Getting started" bash block in the scaffolded README');
  return block[1]!.split('\n');
}

/** What the terminal says to run, minus the `cd`, the dev server, and the "then open" hint. */
function terminalSetup(name: string, template: Template, db: Database): string[] {
  return nextStepLines(name, template, db).filter(
    (line) => !line.startsWith('cd ') && line !== 'bun zt dev' && !line.startsWith('# then open'),
  );
}

describe('the README "Getting started" section', () => {
  // The terminal told a newcomer to migrate; the README said `bun install` then `bun run dev`.
  // The README is the copy that stays around, and following it left no `users` table.
  it.each([...TEMPLATES])('%s: lists exactly the setup the terminal prints', async (template) => {
    await scaffold({ name: 'app', template, db: 'sqlite', target: TMP });

    const commands = await readmeCommands();

    expect(commands[0]).toBe('bun install');
    expect(commands.at(-1)).toBe('bun run dev');
    expect(commands.slice(1, -1)).toEqual(terminalSetup('app', template, 'sqlite'));
  });

  it.each(['postgres', 'mysql'] as const)('api on %s: says where DATABASE_URL goes', async (db) => {
    await scaffold({ name: 'app', template: 'api', db, target: TMP });

    const commands = await readmeCommands();

    expect(commands).toContain('# Set DATABASE_URL in .env');
    expect(commands.indexOf('# Set DATABASE_URL in .env')).toBeLessThan(
      commands.indexOf('bun zt migrate'),
    );
  });

  it('flow, react, vue and api tell you to migrate; minimal and admin do not', async () => {
    const needsMigrate: Record<string, boolean> = {};
    for (const template of TEMPLATES) {
      await scaffold({ name: 'app', template, db: 'sqlite', target: TMP });
      needsMigrate[template] = (await readmeCommands()).includes('bun zt migrate');
      await rm(TMP, { recursive: true, force: true });
    }
    expect(needsMigrate).toEqual({
      minimal: false,
      api: true,
      admin: false,
      flow: true,
      react: true,
      vue: true,
    });
  });

  it('admin seeds its demo account and says where the panel is', async () => {
    await scaffold({ name: 'app', template: 'admin', db: 'sqlite', target: TMP });

    const readme = await Bun.file(join(TMP, 'README.md')).text();

    expect(await readmeCommands()).toContain('bun zt db:seed              # demo data + admin@example.com / password');
    expect(readme).toContain('http://localhost:3000/admin');
  });

  it('leaves no unrendered token behind', async () => {
    for (const template of TEMPLATES) {
      await scaffold({ name: 'app', template, db: 'sqlite', target: TMP });
      expect(await Bun.file(join(TMP, 'README.md')).text()).not.toContain('{{');
      await rm(TMP, { recursive: true, force: true });
    }
  });

  // The structural guard: a template that writes its own block again is the bug coming back.
  it.each([...TEMPLATES])('%s: the source README uses the shared steps, not its own', async (template) => {
    const source = await Bun.file(join(TEMPLATES_DIR, template, 'README.md')).text();

    expect(source).toContain('{{getting_started}}');
    expect(source).not.toMatch(/```bash\s+bun install/);
  });
});
