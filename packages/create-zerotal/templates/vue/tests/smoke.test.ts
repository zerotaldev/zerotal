/**
 * The scaffold boots and serves its pages.
 *
 * A template ships with a `test` script, so it ships with something for that
 * script to run — and this is the assertion that catches a broken starter:
 * providers register, routes resolve, and a request completes. Delete it once
 * you have real tests, or keep it as the shape to copy.
 */
import { beforeAll, afterAll, describe, test, expect } from 'bun:test';
import { createTestApp, type TestApp } from 'zerotal/testing';

let app: TestApp;

beforeAll(async () => {
  // Session encryption needs a key. Seed a deterministic one for tests; `??=`
  // leaves a real key alone when the app's .env is present.
  Bun.env.APP_KEY ??= 'test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa';
  // Each run gets its own throwaway schema rather than the dev database.
  Bun.env.ZT_DB_URL ??= ':memory:';
  app = await createTestApp(() => import('../bootstrap/app.ts').then((m) => m.default));
});

afterAll(() => app.close());

describe('scaffold', () => {
  test('boots and serves the home page', async () => {
    const res = await app.get('/');

    res.assertOk();
    // assertInertia reads the page object out of the response, so the test says
    // which component rendered rather than matching on markup that will change.
    res.assertInertia('home');
  });

  test('renders the other pages', async () => {
    (await app.get('/about')).assertInertia('about');
    (await app.get('/contact')).assertInertia('contact');
  });

  test('answers HEAD on the home route, as probes and load balancers do', async () => {
    const res = await app.head('/');
    expect(res.status).toBeLessThan(400);
  });

  test('returns 404 for an unregistered path', async () => {
    (await app.get('/definitely-not-a-route')).assertNotFound();
  });
});

/**
 * The auth surface, end to end. Registration is the round trip worth asserting:
 * a valid post creates the account, signs the visitor in, and lands them on a
 * page a guest cannot reach — which proves the guard and the session together.
 */
describe('auth', () => {
  test('serves the guest screens', async () => {
    (await app.get('/login')).assertInertia('login');
    (await app.get('/register')).assertInertia('register');
    (await app.get('/forgot-password')).assertInertia('forgot-password');
  });

  test('keeps the profile behind a sign-in', async () => {
    (await app.get('/profile')).assertRedirect('/login');
  });

  test('rejects a registration whose confirmation does not match', async () => {
    const res = await app.postForm(
      '/register',
      {
        name: 'Ada Lovelace',
        email: 'mismatch@example.com',
        password: 'correct-horse-battery',
        password_confirmation: 'something-else',
      },
      { Referer: `${app.baseUrl}/register` },
    );

    res.assertRedirect('/register');
    res.assertInvalid(['password']);
  });

  test('registers a visitor and signs them in', async () => {
    const res = await app.postForm('/register', {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct-horse-battery',
      password_confirmation: 'correct-horse-battery',
    });

    // Landing on /profile is the proof: it is a guarded route, so reaching it
    // means the account was created *and* the session was established.
    res.assertRedirect('/profile');
  });

});
