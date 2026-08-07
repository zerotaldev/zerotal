# Tests

## Running tests

```bash
bun zt test          # run all tests (sets APP_ENV=test, auto-wires the DB)
bun zt test --watch  # watch mode
bun zt test --bail   # stop at the first failure
```

## How a test is put together

`helpers.ts` exports `createApp()`, which boots this application configured for
tests — in-memory database, synchronous queue, a known session secret. Every test
file uses it, so adding a provider to the app means editing one place rather than
every suite.

`auth.test.ts` is a complete worked example. The shape it uses:

```ts
import { describe, it, beforeAll, afterAll } from 'bun:test';
import { migrateDatabase, refreshDatabase, assertDatabaseHas } from '@zerotal/testing';
import type { TestApp } from '@zerotal/testing';
import '../routes/index.ts';
import { createApp } from './helpers.ts';

let app: TestApp;

beforeAll(async () => {
  app = await createApp();
  await migrateDatabase(); // build the schema from database/migrations
});

afterAll(() => app.close());

describe('GET /posts', () => {
  refreshDatabase(); // each test runs in a transaction that rolls back

  it('lists posts', async () => {
    const res = await app.get('/posts');

    res.assertOk();
    res.assertJsonCount(0, 'data');
  });
});
```

Build the schema with `migrateDatabase()` rather than hand-written `CREATE TABLE`
statements. A second definition of your tables drifts from the real one, and you
find out when something fails for a reason unrelated to the change you made.

## Useful assertions

```ts
res.assertOk();                          // and assertCreated, assertNotFound, …
res.assertJsonPath('data.0.title', 'Hi');
res.assertInvalid('email');              // 422 errors, or errors flashed to the session
res.assertAuthenticatedAs(user);
res.assertSessionHas('cart_id');
await assertDatabaseHas('posts', { slug: 'hello' });
```

When a test fails on an unexpected `500`, ask for the exception instead of
guessing from the rendered page:

```ts
const res = await app.withoutExceptionHandling().get('/checkout');
console.log(res.exception());
```

## Generators

```bash
bun zt make:test PostTest         # tests/feature/PostTest.ts
bun zt make:test SlugTest --unit  # tests/unit/SlugTest.ts
bun zt make:factory User          # database/factories/UserFactory.ts
```
