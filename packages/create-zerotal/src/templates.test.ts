import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { TEMPLATES } from './args.ts';

/**
 * Invariants of the template sources — the first-run faults of 1.15.2, held in place.
 *
 * A scaffolded app cannot be booted from inside this workspace (the umbrella `zerotal`
 * package is not linked here), so these read the sources instead. They are narrow on
 * purpose: each one names a rule a template broke, and that a newcomer found by running
 * `zt doctor` or opening the URL the dev server printed.
 */

const TEMPLATES_DIR = join(import.meta.dir, '..', 'templates');
const read = (template: string, rel: string): Promise<string> =>
  Bun.file(join(TEMPLATES_DIR, template, rel)).text();

describe('config/app.ts', () => {
  // `AppConfig` is what fills `allowedOrigins` from `url`. The api template exported a bare
  // object, so `zt doctor` failed ("allowedOrigins is empty") on an app with no code of its own,
  // and told the newcomer to set a `url` that was already set.
  it.each([...TEMPLATES])('%s wraps its config in AppConfig, so allowedOrigins is filled', async (template) => {
    const config = await read(template, 'config/app.ts');

    expect(config).toMatch(/export default AppConfig\(/);
  });

  it.each([...TEMPLATES])('%s refuses to start without an APP_KEY', async (template) => {
    expect(await read(template, 'config/app.ts')).toMatch(/requireEnv\(\s*['"]APP_KEY['"]\s*\)/);
  });
});

describe('the users migration', () => {
  // The Authenticatable mixin registers `remember_token` imperatively, and the boot step only
  // adds it to a table that already exists. A migration that omits it leaves `zt doctor` red
  // between `migrate` and the first boot — and the doctor's own advice is "put it in a migration".
  const usersMigration = (template: string): string | undefined => {
    const dir = join(TEMPLATES_DIR, template, 'database', 'migrations');
    if (!existsSync(dir)) return undefined;
    return readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => join(dir, file))
      .find((path) => /Schema\.create\(\s*['"]users['"]/.test(readFileSync(path, 'utf8')));
  };

  it('is checked for the templates that have both an Authenticatable User and a users migration', async () => {
    const checked: string[] = [];
    for (const template of TEMPLATES) {
      const modelPath = join(TEMPLATES_DIR, template, 'app', 'models', 'User.ts');
      const migration = usersMigration(template);
      if (!existsSync(modelPath) || !migration) continue;
      if (!(await Bun.file(modelPath).text()).includes('Authenticatable')) continue;

      checked.push(template);
      expect(await Bun.file(migration).text()).toMatch(/rememberToken\(\)|remember_token/);
    }
    // Guards the guard: if this list shrinks, the test has gone vacuous, not the templates clean.
    expect(checked.sort()).toEqual(['flow', 'react']);
  });
});

describe('the admin template', () => {
  // The dev server prints http://localhost:3000, and this app has no page there. A newcomer who
  // opened the printed URL got `{"message":"Not Found","code":"E_NOT_FOUND"}` and no hint that
  // the panel is at /admin.
  it('sends the bare origin to the panel', async () => {
    expect(await read('admin', 'routes/web.ts')).toMatch(/Router\.get\(\s*["']\/["']/);
    expect(await read('admin', 'routes/web.ts')).toMatch(/redirect\(\s*["']\/admin["']/);
  });

  it('declares that route group at boot, or the route file is never loaded', async () => {
    expect(await read('admin', 'bootstrap/app.ts')).toMatch(/routes\/web\.ts/);
  });

  it('ships a test of it, so every generated app keeps it', async () => {
    const tests = await read('admin', 'tests/admin.test.ts.tmpl');

    expect(tests).toMatch(/get\(\s*["']\/["']/);
    expect(tests).toMatch(/assertRedirect\(\s*["']\/admin["']\s*\)/);
  });
});
