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

// The example resources are the code a new app copies from, so a cast in one is copied into
// every resource written after it. The admin kit's product actions and dashboard carried two.
describe('the example resources', () => {
  const sources = (template: string, pattern: string): string[] =>
    [...new Bun.Glob(pattern).scanSync({ cwd: join(TEMPLATES_DIR, template), onlyFiles: true })].map((rel) => join(template, rel));

  it('hold no `as unknown as` or `as never`', () => {
    const files = [
      ...sources('admin', 'app/admin/**/*.ts'),
      ...sources('admin', 'app/models/*.ts'),
      ...['react', 'vue', 'flow'].flatMap((kit) =>
        sources(kit, '{app,resources,database}/**/*.{ts,tsx,vue}').filter((f) => /project/i.test(f)),
      ),
    ];
    expect(files.length).toBeGreaterThan(10);
    const casts = files.filter((f) => /\bas (unknown as|never)\b/.test(readFileSync(join(TEMPLATES_DIR, f), 'utf8')));
    expect(casts).toEqual([]);
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

describe.each(Object.entries(KITS))('the %s kit', (template, kit) => {
  const { extension, pages, layouts, components } = kit;
  const omitted: readonly string[] = 'omits' in kit ? kit.omits : [];
  // React is the reference; the other kits are ports of it, checked against the same list.
  const KIT = join(TEMPLATES_DIR, template);
  const has = (rel: string): boolean => existsSync(join(KIT, rel));

  it.each([...MANIFEST.pages])('has the %s page', (page) => {
    expect({ page, exists: has(`${pages}/${page}${extension}`) }).toEqual({ page, exists: true });
  });

  it.each([...MANIFEST.layouts])('has the %s layout', (layout) => {
    expect({ layout, exists: has(`${layouts}/${layout}${extension}`) }).toEqual({ layout, exists: true });
  });

  it.each(MANIFEST.components.filter((c) => !omitted.includes(c)))('has the %s component', (component) => {
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

  // Browsers ask for /favicon.ico whatever the page links, and every kit answered 404.
  it('ships a favicon.ico, and links it', async () => {
    const icon = new Uint8Array(await Bun.file(join(KIT, 'public', 'favicon.ico')).arrayBuffer());
    // An ICO header: reserved 0, type 1 (icon), at least one image.
    expect([...icon.slice(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(icon[4]).toBeGreaterThan(0);

    const head = template === 'flow'
      ? readFileSync(join(KIT, 'app', 'flow', 'lib', 'document.ts'), 'utf8')
      : readFileSync(join(KIT, 'resources', 'app.html'), 'utf8');
    expect(head).toContain('<link rel="icon" href="/favicon.ico"');
  });

  // The border's <rect> had no fill, so it defaulted to black and covered the gradient:
  // the logo in the header and sidebar was a black square.
  it('draws the logo with no shape filled black by default', () => {
    const svg = readFileSync(join(KIT, 'public', 'zt.svg'), 'utf8');
    const unfilled = [...svg.matchAll(/<(rect|circle|path|ellipse|polygon)\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => !/\sfill=/.test(tag));
    expect(unfilled).toEqual([]);
  });

  // Both inputs on the two-factor challenge carry a visible label tied to the control: the
  // shared field components bind it by id in React and Vue, and Flow writes `for`/`id` itself.
  it('labels both inputs on the two-factor challenge', () => {
    const page = readFileSync(join(KIT, pages, `auth/two-factor-challenge${extension}`), 'utf8');
    if (template === 'flow') {
      for (const id of ['field-code', 'field-recovery_code']) {
        expect(page).toContain(`<label for="${id}"`);
        expect(page).toContain(`id="${id}"`);
      }
    } else {
      expect(page).toContain('label="Authentication code"');
      expect(page).toContain('label="Recovery code"');
    }
  });

  // The header, footer and sidebar "Documentation" links went to the GitHub repository.
  it('points its Documentation links at the docs site', () => {
    const site = template === 'flow'
      ? join(KIT, 'app', 'flow', 'lib', 'site.ts')
      : join(KIT, 'resources', 'js', 'lib', 'site.ts');
    expect(readFileSync(site, 'utf8')).toContain('export const DOCS_URL = "https://zerotal.dev/docs";');
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

describe('the vue kit', () => {
  // A comment at the top of a component's <template> is a second root node in a production
  // build. Vue's production runtime then passes no outside attributes through, so
  // `<Icon class="size-4" />` rendered an unsized icon, while the dev server, which skips
  // comments there, looked right. A component's comment goes above its <template> instead.
  it('starts no component or layout template with a comment', async () => {
    const KIT = join(TEMPLATES_DIR, 'vue');
    const offenders: string[] = [];
    for (const dir of [KITS.vue.components, KITS.vue.layouts]) {
      for await (const rel of new Bun.Glob('**/*.vue').scan({ cwd: join(KIT, dir) })) {
        const source = await Bun.file(join(KIT, dir, rel)).text();
        if (/<template>\s*<!--/.test(source)) offenders.push(`${dir}/${rel}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
