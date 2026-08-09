import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { scaffold, ZT_VERSION } from './scaffold.ts';

const TMP = join(import.meta.dir, '..', '.test-output');

// ── released version ─────────────────────────────────────────────────────────

describe('ZT_VERSION', () => {
  it('matches the version this package is published at', async () => {
    // The monorepo releases in lockstep, so a create-zerotal@X.Y.Z that stamps
    // any other range points new projects at packages that need not exist. This
    // drifted once — create-zerotal@1.0.0 scaffolded `^1.1.0` against a registry
    // holding 1.0.0, so every `bun create zerotal` ended in "No version matching
    // ^1.1.0 found for specifier zerotal". Nothing else catches it: the scaffold
    // succeeds, and only the install the user runs afterwards fails.
    const pkg = await Bun.file(join(import.meta.dir, '..', 'package.json')).json();

    expect(ZT_VERSION).toBe(`^${pkg.version}`);
  });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

// ── minimal template ─────────────────────────────────────────────────────────

describe('scaffold — minimal template', () => {
  it('creates expected files', async () => {
    await scaffold({ name: 'my-app', template: 'minimal', db: 'sqlite', target: TMP });

    expect(await Bun.file(join(TMP, 'zt.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'package.json')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'tsconfig.json')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, '.env.example')).exists()).toBe(true);  // renamed from _env.example
    expect(await Bun.file(join(TMP, '.gitignore')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'bootstrap/app.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'routes/index.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'config/app.ts')).exists()).toBe(true);
    // JSX view + bundled asset entrypoint (built by `bun zerotal serve`).
    expect(await Bun.file(join(TMP, 'resources/js/pages/welcome.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/css/app.css')).exists()).toBe(true);
  });

  it('substitutes project name token', async () => {
    await scaffold({ name: 'hello-world', template: 'minimal', db: 'sqlite', target: TMP });

    const pkg = JSON.parse(await Bun.file(join(TMP, 'package.json')).text()) as { name: string };
    expect(pkg.name).toBe('hello-world');

    const appConfig = await Bun.file(join(TMP, 'config/app.ts')).text();
    expect(appConfig).toContain('hello-world');
    expect(appConfig).not.toContain('{{name}}');
  });

  it('generates a unique APP_KEY in .env.example', async () => {
    await scaffold({ name: 'app', template: 'minimal', db: 'sqlite', target: TMP });
    const env = await Bun.file(join(TMP, '.env.example')).text();
    expect(env).toMatch(/APP_KEY=[A-Za-z0-9+/]+=*/);
    expect(env).not.toContain('{{app_key}}');
  });

  it('writes a ready-to-run .env so a fresh app boots with a real APP_KEY', async () => {
    await scaffold({ name: 'app', template: 'minimal', db: 'sqlite', target: TMP });
    const dotenv = await Bun.file(join(TMP, '.env'));
    expect(await dotenv.exists()).toBe(true);
    const text = await dotenv.text();
    expect(text).toMatch(/APP_KEY=[A-Za-z0-9+/]+=*/);
    expect(text).not.toContain('{{app_key}}');
  });

  it('generates a real SESSION_SECRET (no change-me placeholder) in the api template', async () => {
    await scaffold({ name: 'app', template: 'api', db: 'sqlite', target: TMP });
    const env = await Bun.file(join(TMP, '.env')).text();
    expect(env).toMatch(/SESSION_SECRET=[A-Za-z0-9+/]+=*/);
    expect(env).not.toContain('change-me-in-production');
  });

  it('renames _gitignore to .gitignore', async () => {
    await scaffold({ name: 'app', template: 'minimal', db: 'sqlite', target: TMP });
    expect(await Bun.file(join(TMP, '.gitignore')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, '_gitignore')).exists()).toBe(false);
  });

  // Template test files are stored with a trailing `.tmpl` so Bun does not collect them
  // while this package is developed in the monorepo — their `zerotal/testing` imports
  // only resolve inside a scaffolded app. The scaffolder has to strip it, or the app
  // ships a test file the runner never sees.
  it('strips the .tmpl suffix so the scaffolded test is discoverable', async () => {
    await scaffold({ name: 'app', template: 'minimal', db: 'sqlite', target: TMP });

    expect(await Bun.file(join(TMP, 'tests/smoke.test.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'tests/smoke.test.ts.tmpl')).exists()).toBe(false);
  });

  it('leaves no file Bun would collect as a test inside templates/', async () => {
    // The suffix has to be one Bun's matcher ignores. `_test.ts` is not: Bun globs it
    // exactly like `.test.ts`, which is why these files used to fail every root run.
    const { Glob } = await import('bun');
    const templates = join(import.meta.dir, '..', 'templates');
    const collected: string[] = [];

    for (const pattern of ['**/*.test.ts', '**/*_test.ts', '**/*.spec.ts', '**/*_spec.ts']) {
      for await (const rel of new Glob(pattern).scan({ cwd: templates, onlyFiles: true })) {
        collected.push(rel);
      }
    }

    expect(collected).toEqual([]);
  });

  it('leaves no unreplaced {{tokens}}', async () => {
    await scaffold({ name: 'test-app', template: 'minimal', db: 'sqlite', target: TMP });
    const files = ['package.json', 'zt.ts', 'config/app.ts', '.env.example',
                   'routes/index.ts', 'bootstrap/app.ts', 'resources/js/pages/welcome.tsx'];
    for (const f of files) {
      const text = await Bun.file(join(TMP, f)).text();
      expect(text, `${f} still has unreplaced tokens`).not.toContain('{{');
    }
  });
});

// ── install() ────────────────────────────────────────────────────────────────

import { install } from './scaffold.ts';

describe('install()', () => {
  it('returns true when bun install exits with code 0', async () => {
    // Stub Bun.spawn to return a resolved exited = 0
    const origSpawn = Bun.spawn;
    (Bun as unknown as Record<string, unknown>).spawn = (_cmd: string[], _opts: unknown) => ({
      exited: Promise.resolve(0),
    });
    try {
      const result = await install('/tmp/fake-project');
      expect(result).toBe(true);
    } finally {
      (Bun as unknown as Record<string, unknown>).spawn = origSpawn;
    }
  });

  it('returns false when bun install exits with non-zero code', async () => {
    const origSpawn = Bun.spawn;
    (Bun as unknown as Record<string, unknown>).spawn = (_cmd: string[], _opts: unknown) => ({
      exited: Promise.resolve(1),
    });
    try {
      const result = await install('/tmp/bad-project');
      expect(result).toBe(false);
    } finally {
      (Bun as unknown as Record<string, unknown>).spawn = origSpawn;
    }
  });
});

// ── api template ─────────────────────────────────────────────────────────────

describe('scaffold — api template', () => {
  it('creates auth controller, model, middleware, migration, tests', async () => {
    await scaffold({ name: 'blog', template: 'api', db: 'sqlite', target: TMP });

    expect(await Bun.file(join(TMP, 'app/controllers/AuthController.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/models/User.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/middleware/RequireAuth.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'database/migrations/0001_create_users_table.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'tests/helpers.ts')).exists()).toBe(true);
  });

  it('substitutes the SQLite DB URL in database config', async () => {
    await scaffold({ name: 'app', template: 'api', db: 'sqlite', target: TMP });
    const db = await Bun.file(join(TMP, 'config/database.ts')).text();
    expect(db).toContain('./database/db.sqlite');
    expect(db).not.toContain('{{db_url}}');
  });

  it('substitutes the PostgreSQL DB URL', async () => {
    await scaffold({ name: 'app', template: 'api', db: 'postgres', target: TMP });
    const db = await Bun.file(join(TMP, 'config/database.ts')).text();
    expect(db).toContain('postgres://localhost/app');
  });

  it('substitutes the MySQL DB URL', async () => {
    await scaffold({ name: 'app', template: 'api', db: 'mysql', target: TMP });
    const db = await Bun.file(join(TMP, 'config/database.ts')).text();
    expect(db).toContain('mysql://root@localhost/app');
  });
});

// ── admin template ─────────────────────────────────────────────────────────────

describe('scaffold — admin template', () => {
  it('creates the panel wiring, resources, seeder and tests', async () => {
    await scaffold({ name: 'my-admin', template: 'admin', db: 'sqlite', target: TMP });

    expect(await Bun.file(join(TMP, 'zt.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'bootstrap/providers.ts')).exists()).toBe(true);
    // The panel wiring lives in app/admin/, which AdminProvider loads on boot.
    expect(await Bun.file(join(TMP, 'app/admin/index.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/admin/ProductResource.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/admin/SettingsResource.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/admin/UserResource.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/admin/widgets.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/models/Product.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'database/seeders/DatabaseSeeder.ts')).exists()).toBe(true);
    // The .tmpl infix is stripped so the test lands as a real test file.
    expect(await Bun.file(join(TMP, 'tests/admin.test.ts')).exists()).toBe(true);
  });

  it('registers AdminProvider and substitutes the project name', async () => {
    await scaffold({ name: 'shop-admin', template: 'admin', db: 'sqlite', target: TMP });

    const pkg = JSON.parse(await Bun.file(join(TMP, 'package.json')).text()) as {
      name: string;
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe('shop-admin');
    expect(pkg.dependencies['@zerotal/admin']).toBeDefined();
    // The stable set (core, auth, orm, ...) rides in through the meta package.
    expect(pkg.dependencies['zerotal']).toBeDefined();
    expect(pkg.dependencies['@zerotal/auth']).toBeUndefined();
    expect(pkg.scripts['seed']).toBe('bun zt.ts db:seed');

    const providers = await Bun.file(join(TMP, 'bootstrap/providers.ts')).text();
    expect(providers).toContain('AdminProvider');

    const panel = await Bun.file(join(TMP, 'app/admin/index.ts')).text();
    expect(panel).toContain('shop-admin');
  });

  it('ships the panel behind an auth guard rather than open', async () => {
    await scaffold({ name: 'guarded', template: 'admin', db: 'sqlite', target: TMP });
    const panel = await Bun.file(join(TMP, 'app/admin/index.ts')).text();
    // A panel with no middleware refuses to serve outside local development —
    // the template must not ship depending on that fallback.
    expect(panel).toContain('AuthMiddleware');
    expect(panel).toContain('Panel.auth(');
  });

  it('leaves no unreplaced {{tokens}}', async () => {
    await scaffold({ name: 'admin-test', template: 'admin', db: 'sqlite', target: TMP });
    const files = ['package.json', 'zt.ts', 'config/app.ts', '.env.example',
                   'app/admin/index.ts', 'app/admin/ProductResource.ts',
                   'database/seeders/DatabaseSeeder.ts'];
    for (const f of files) {
      const text = await Bun.file(join(TMP, f)).text();
      expect(text, `${f} still has unreplaced tokens`).not.toContain('{{');
    }
  });
});

// ── flow template ────────────────────────────────────────────────────────────

describe('scaffold — flow template', () => {
  it('creates Flow pages, layout, and the logo asset', async () => {
    await scaffold({ name: 'my-flow', template: 'flow', db: 'sqlite', target: TMP });

    expect(await Bun.file(join(TMP, 'zt.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'bootstrap/providers.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/flow/layouts/app.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/flow/pages/index.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/flow/pages/about.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/flow/pages/contact.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'public/zt.svg')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/css/app.css')).exists()).toBe(true);
  });

  it('registers FlowProvider and substitutes the project name', async () => {
    await scaffold({ name: 'flow-app', template: 'flow', db: 'sqlite', target: TMP });

    const pkg = JSON.parse(await Bun.file(join(TMP, 'package.json')).text()) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('flow-app');
    expect(pkg.dependencies['@zerotal/flow']).toBeDefined();

    const providers = await Bun.file(join(TMP, 'bootstrap/providers.ts')).text();
    expect(providers).toContain('FlowProvider');
  });

  it('leaves no unreplaced {{tokens}}', async () => {
    await scaffold({ name: 'flow-test', template: 'flow', db: 'sqlite', target: TMP });
    const files = ['package.json', 'zt.ts', 'config/app.ts', '.env.example',
                   'app/flow/pages/index.tsx', 'app/flow/layouts/app.tsx'];
    for (const f of files) {
      const text = await Bun.file(join(TMP, f)).text();
      expect(text, `${f} still has unreplaced tokens`).not.toContain('{{');
    }
  });
});

// ── react template ─────────────────────────────────────────────────────────────

describe('scaffold — react template', () => {
  it('creates Inertia + React pages, layout, and routes', async () => {
    await scaffold({ name: 'my-react', template: 'react', db: 'sqlite', target: TMP });

    expect(await Bun.file(join(TMP, 'zt.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'bootstrap/providers.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/app.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/Layouts/AppLayout.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/pages/home.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/pages/about.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/pages/contact.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/routes/index.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, '.env.example')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, '.gitignore')).exists()).toBe(true);
  });

  it('registers InertiaProvider, uses React deps, and substitutes the name', async () => {
    await scaffold({ name: 'react-app', template: 'react', db: 'sqlite', target: TMP });

    const pkg = JSON.parse(await Bun.file(join(TMP, 'package.json')).text()) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('react-app');
    expect(pkg.dependencies['@inertiajs/react']).toBeDefined();
    expect(pkg.dependencies['react']).toBeDefined();

    const providers = await Bun.file(join(TMP, 'bootstrap/providers.ts')).text();
    expect(providers).toContain('InertiaProvider');

    // React pages must compile against React's JSX runtime, not Flow's.
    const tsconfig = await Bun.file(join(TMP, 'tsconfig.json')).text();
    expect(tsconfig).toContain('"jsxImportSource": "react"');
  });

  it('leaves no unreplaced {{tokens}}', async () => {
    await scaffold({ name: 'react-test', template: 'react', db: 'sqlite', target: TMP });
    const files = ['package.json', 'zt.ts', 'config/app.ts', '.env.example',
                   'resources/js/app.tsx', 'app/routes/index.ts'];
    for (const f of files) {
      const text = await Bun.file(join(TMP, f)).text();
      expect(text, `${f} still has unreplaced tokens`).not.toContain('{{');
    }
  });
});

// ── vue template ───────────────────────────────────────────────────────────────

describe('scaffold — vue template', () => {
  it('creates Inertia + Vue SFC pages, layout, and routes', async () => {
    await scaffold({ name: 'my-vue', template: 'vue', db: 'sqlite', target: TMP });

    expect(await Bun.file(join(TMP, 'zt.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'bootstrap/providers.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/app.tsx')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/Layouts/AppLayout.vue')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/pages/home.vue')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/pages/about.vue')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'resources/js/pages/contact.vue')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, 'app/routes/index.ts')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, '.env.example')).exists()).toBe(true);
    expect(await Bun.file(join(TMP, '.gitignore')).exists()).toBe(true);
  });

  it('registers InertiaProvider, uses Vue deps, and substitutes the name', async () => {
    await scaffold({ name: 'vue-app', template: 'vue', db: 'sqlite', target: TMP });

    const pkg = JSON.parse(await Bun.file(join(TMP, 'package.json')).text()) as {
      name: string;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('vue-app');
    expect(pkg.dependencies['@inertiajs/vue3']).toBeDefined();
    expect(pkg.dependencies['vue']).toBeDefined();
    expect(pkg.devDependencies['@vue/compiler-sfc']).toBeDefined();

    const providers = await Bun.file(join(TMP, 'bootstrap/providers.ts')).text();
    expect(providers).toContain('InertiaProvider');

    const tsconfig = await Bun.file(join(TMP, 'tsconfig.json')).text();
    expect(tsconfig).toContain('"jsxImportSource": "vue"');
  });

  it('leaves no unreplaced {{tokens}}', async () => {
    await scaffold({ name: 'vue-test', template: 'vue', db: 'sqlite', target: TMP });
    const files = ['package.json', 'zt.ts', 'config/app.ts', '.env.example',
                   'resources/js/app.tsx', 'app/routes/index.ts'];
    for (const f of files) {
      const text = await Bun.file(join(TMP, f)).text();
      expect(text, `${f} still has unreplaced tokens`).not.toContain('{{');
    }
  });
});
