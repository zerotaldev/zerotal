import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { scaffold } from './scaffold.ts';

/**
 * The api starter, booted from its own `bootstrap/app.ts`, signs a user in.
 *
 * The starter's own suite builds its app in `tests/helpers.ts`, wiring the session middleware
 * with a user loader of its own, so no test of it ever boots the real bootstrap. That is how its
 * `User` model lost `Authenticatable` unseen: auth found no user model, `GET /me` answered 401
 * right after a successful `POST /login`, and every starter test still passed.
 *
 * So this scaffolds the starter outside the workspace, links the workspace's packages in as its
 * `node_modules`, and runs a test of its own through the app's `bun zt.ts test`, which loads the
 * app's `config/` and `.env` as a generated app does.
 */

const PACKAGES = join(import.meta.dir, '..', '..');

/** Link every workspace package into `dir/node_modules`, as an install of them would place them. */
function linkWorkspacePackages(dir: string): void {
  const modules = join(dir, 'node_modules');
  mkdirSync(join(modules, '@zerotal'), { recursive: true });
  for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'create-zerotal') continue;
    const link = entry.name === 'zerotal' ? join(modules, 'zerotal') : join(modules, '@zerotal', entry.name);
    // A junction on Windows needs no privilege; elsewhere the type is ignored and it is a symlink.
    symlinkSync(join(PACKAGES, entry.name), link, 'junction');
  }
}

/**
 * Remove the links before the folder, so nothing is deleted through them, and leave the folder
 * in place if any link is still there.
 */
function removeApp(dir: string): void {
  const modules = join(dir, 'node_modules');
  const links = (): string[] => [
    ...readdirSync(modules).filter((name) => name === 'zerotal').map((name) => join(modules, name)),
    ...readdirSync(join(modules, '@zerotal')).map((name) => join(modules, '@zerotal', name)),
  ];
  for (const link of links()) {
    // A junction is removed as a directory on Windows, a symlink as a file elsewhere; neither
    // touches what it points at.
    try {
      unlinkSync(link);
    } catch {
      rmdirSync(link);
    }
  }
  if (links().length > 0) throw new Error(`could not unlink every package in ${modules}`);
  rmSync(dir, { recursive: true, force: true });
}

const PROBE = `import { beforeAll, afterAll, expect, test } from 'bun:test';
import { createTestApp, migrateDatabase, type TestApp } from 'zerotal/testing';

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp(() => import('../bootstrap/app.ts').then((m) => m.default));
  await migrateDatabase();
});

afterAll(() => app.close());

/** The session cookie a response set, as the name and value a browser would send back. */
function sessionCookie(res: { headers: Headers }): [string, string] {
  const pair = res.headers.getSetCookie().map((line) => line.split(';')[0]!).find((p) => p.startsWith('session='));
  if (!pair) throw new Error('the response set no session cookie');
  return ['session', pair.slice('session='.length)];
}

test('a user who registers is signed in', async () => {
  const register = await app.asJson().post('/register', { name: 'Ada', email: 'ada@example.com', password: 'correct-horse' });
  register.assertCreated();

  const me = await app.withoutCookies().withCookie(...sessionCookie(register)).asJson().get('/me');
  me.assertOk();
  expect(me.json().data.email).toBe('ada@example.com');
});

test('a user who logs in is signed in', async () => {
  const login = await app.withoutCookies().asJson().post('/login', { email: 'ada@example.com', password: 'correct-horse' });
  login.assertOk();

  const me = await app.withoutCookies().withCookie(...sessionCookie(login)).asJson().get('/me');
  me.assertOk();
  expect(me.json().data.email).toBe('ada@example.com');
});
`;

describe('the api starter, booted from its own bootstrap', () => {
  let dir: string;
  let run: { code: number; output: string };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'zerotal-api-boot-'));
    await scaffold({ name: 'boot-check', template: 'api', db: 'sqlite', target: dir });
    linkWorkspacePackages(dir);
    writeFileSync(join(dir, 'tests', 'real-bootstrap.test.ts'), PROBE);

    const proc = Bun.spawn([process.execPath, 'zt.ts', 'test', 'real-bootstrap'], {
      cwd: dir,
      // The test database is a fresh in-memory one, not the file `.env` names.
      env: { ...process.env, ZT_DB_URL: ':memory:' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    run = { code, output: `${out}\n${err}` };
  }, 180_000);

  afterAll(() => {
    if (dir) removeApp(dir);
  });

  it('runs both sign-in round trips and passes them', () => {
    expect({ code: run.code, output: run.output }).toMatchObject({ code: 0 });
    expect(run.output).toMatch(/\b2 pass\b/);
    expect(run.output).toMatch(/\b0 fail\b/);
  });
});
