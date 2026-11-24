import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { TEMPLATES } from './args.ts';
import { KITS, MANIFEST } from './manifest.ts';

/**
 * Invariants of the template sources — the first-run faults of 1.15.2, held in place.
 *
 * A scaffolded app cannot be booted from inside this workspace (the umbrella `zerotal`
 * package is not linked here), so these read the sources instead; `boot.test.ts` boots one
 * outside it, with the workspace packages linked in. They are narrow on
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
    expect(checked.sort()).toEqual(['admin', 'api', 'flow', 'react', 'vue']);
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

describe.each(Object.entries(KITS))('the %s kit', (template, { extension, pages, layouts, components }) => {
  // React is the reference; the other kits are ports of it, checked against the same list.
  const KIT = join(TEMPLATES_DIR, template);
  const has = (rel: string): boolean => existsSync(join(KIT, rel));

  it.each([...MANIFEST.pages])('has the %s page', (page) => {
    expect({ page, exists: has(`${pages}/${page}${extension}`) }).toEqual({ page, exists: true });
  });

  it.each([...MANIFEST.layouts])('has the %s layout', (layout) => {
    expect({ layout, exists: has(`${layouts}/${layout}${extension}`) }).toEqual({ layout, exists: true });
  });

  it.each([...MANIFEST.components])('has the %s component', (component) => {
    expect({ component, exists: has(`${components}/${component}${extension}`) }).toEqual({
      component,
      exists: true,
    });
  });

  it('declares every route, at its path and verb, in the committed route table', async () => {
    // `types/routes.generated.ts` is what `bun zt route:types` writes from the route files,
    // and what `route()` reads in the browser — so a route missing from it is one the pages
    // cannot link to.
    const { ROUTES, METHODS } = (await import(join(KIT, 'types', 'routes.generated.ts'))) as {
      ROUTES: Record<string, string>;
      METHODS: Record<string, string>;
    };
    const missing = MANIFEST.routes.filter(
      (r) => ROUTES[r.name] !== r.path || METHODS[r.name] !== r.method,
    );
    expect(missing).toEqual([]);
  });

  it.each(MANIFEST.tests.map((t) => [t.file, t] as const))('ships %s with every named test', async (_file, test) => {
    const path = join(KIT, 'tests', `${test.file}.ts.tmpl`);
    expect({ file: test.file, exists: existsSync(path) }).toEqual({ file: test.file, exists: true });
    const source = await Bun.file(path).text();
    expect({ file: test.file, missing: test.names.filter((name) => !source.includes(`'${name}'`) && !source.includes(`"${name}"`)) }).toEqual({
      file: test.file,
      missing: [],
    });
  });

  it('takes the app name from config/app.ts rather than stamping it into the UI', async () => {
    // The name is stamped once, as the default of APP_NAME. A page, layout or mail that
    // repeats it is a second copy that a rename misses.
    const STAMPED_ON_PURPOSE = new Set([
      'README.md',
      '_env.example',
      'package.json',
      'config/app.ts',
      'config/session.ts', // the cookie name, which must not change when the app is renamed
      'resources/app.html', // the pre-render <title>; the page's own title replaces it
      'Dockerfile', // the image tag in a usage comment
    ]);
    const stamped: string[] = [];
    for await (const rel of new Bun.Glob('**/*').scan({ cwd: KIT, onlyFiles: true })) {
      const path = rel.replace(/\\/g, '/');
      if (STAMPED_ON_PURPOSE.has(path)) continue;
      if ((await Bun.file(join(KIT, rel)).text()).includes('{{name}}')) stamped.push(path);
    }
    expect(stamped).toEqual([]);
  });
});
