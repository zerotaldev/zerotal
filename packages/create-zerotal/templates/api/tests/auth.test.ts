import { describe, it, beforeAll, afterAll } from 'bun:test';
import {
  migrateDatabase,
  refreshDatabase,
  assertDatabaseHas,
  assertDatabaseMissing,
  type TestApp,
} from 'zerotal/testing';
import { registerRoutes } from '../routes/index.ts';
import { createApp } from './helpers.ts';

let app: TestApp;

beforeAll(async () => {
  // Routes are registered through the setup callback, not by importing this
  // file for its side effects: `createTestApp` resets the router before it
  // runs setup, and a module's top-level code only executes once per process.
  app = await createApp(registerRoutes);
  // Build the schema from the same migrations that ship, rather than from a
  // second copy of the tables written by hand — the two always drift.
  await migrateDatabase();
});

afterAll(() => app.close());

describe('registration', () => {
  // Every test below runs in a transaction that rolls back, so they each start
  // from the same empty database and can be read in any order.
  refreshDatabase();

  it('creates a user and signs them in', async () => {
    const res = await app.asJson().post('/register', {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct-horse',
    });

    res.assertCreated();
    res.assertJsonPath('data.email', 'ada@example.com');
    await assertDatabaseHas('users', { email: 'ada@example.com' });
  });

  it('never stores the password as given', async () => {
    await app.asJson().post('/register', {
      name: 'Ada',
      email: 'ada@example.com',
      password: 'correct-horse',
    });

    await assertDatabaseMissing('users', { password: 'correct-horse' });
  });

  it('rejects an incomplete payload', async () => {
    const res = await app.asJson().post('/register', { email: 'ada@example.com' });

    res.assertUnprocessable();
    await assertDatabaseMissing('users', { email: 'ada@example.com' });
  });

  it('rejects a duplicate email', async () => {
    const payload = { name: 'Ada', email: 'ada@example.com', password: 'secret' };
    await app.asJson().post('/register', payload);

    const res = await app.asJson().post('/register', payload);

    res.assertUnprocessable();
  });
});

describe('login', () => {
  refreshDatabase();

  it('signs a registered user in', async () => {
    await app.asJson().post('/register', {
      name: 'Ada',
      email: 'ada@example.com',
      password: 'correct-horse',
    });

    const res = await app.asJson().post('/login', {
      email: 'ada@example.com',
      password: 'correct-horse',
    });

    res.assertOk();
    res.assertAuthenticated();
  });

  it('refuses a wrong password without saying which field was wrong', async () => {
    await app.asJson().post('/register', {
      name: 'Ada',
      email: 'ada@example.com',
      password: 'correct-horse',
    });

    const res = await app.asJson().post('/login', {
      email: 'ada@example.com',
      password: 'wrong',
    });

    res.assertUnauthorized();
    res.assertGuest();
  });

  it('refuses an unknown email', async () => {
    const res = await app.asJson().post('/login', {
      email: 'nobody@example.com',
      password: 'secret',
    });

    res.assertUnauthorized();
  });
});

describe('GET /me', () => {
  refreshDatabase();

  it('turns a guest away', async () => {
    const res = await app.actingAsGuest().asJson().get('/me');

    res.assertUnauthorized();
  });

  it('returns the signed-in user', async () => {
    const created = await app.asJson().post('/register', {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct-horse',
    });
    const id = created.json<{ data: { id: number } }>().data.id;

    const res = await app.actingAs({ id }).asJson().get('/me');

    res.assertOk();
    res.assertJsonPath('data.name', 'Ada Lovelace');
  });
});
