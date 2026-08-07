/**
 * The scaffold boots and serves its pages.
 *
 * Two levels are shown here, and they answer different questions. The HTTP tests
 * confirm the app wires up: providers register, file-based routes resolve, a
 * request completes. The FlowTest block drives a page's own lifecycle in
 * process — no server and no browser — which is where you test what a component
 * does rather than that it exists.
 */
import { beforeAll, afterAll, describe, test, expect } from 'bun:test';
import { createTestApp, type TestApp } from 'zerotal/testing';
import { FlowTest } from '@zerotal/flow/testing';
import { ContactPage } from '../app/flow/pages/contact.tsx';

let app: TestApp;

beforeAll(async () => {
  // Flow snapshot signing and session encryption both need a key. Seed a
  // deterministic one for tests; `??=` leaves a real key alone when the app's
  // .env is present.
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
  });

  test('serves every file-based page', async () => {
    (await app.get('/about')).assertOk();
    (await app.get('/contact')).assertOk();
  });

  test('answers HEAD on the home route, as probes and load balancers do', async () => {
    const res = await app.head('/');
    expect(res.status).toBeLessThan(400);
  });

  test('returns 404 for an unregistered path', async () => {
    (await app.get('/definitely-not-a-route')).assertNotFound();
  });
});

describe('the contact page component', () => {
  test('renders its content without a server or a browser', async () => {
    const page = await FlowTest.mount(ContactPage);

    page.assertSee('Contact');
    page.assertSee('hello@example.com');
  });
});

/**
 * The auth surface. The guard is the assertion that matters: /profile must be
 * unreachable without a session, however the page itself is built.
 */
describe('auth', () => {
  test('serves the guest screens', async () => {
    (await app.get('/login')).assertOk();
    (await app.get('/register')).assertOk();
    (await app.get('/forgot-password')).assertOk();
  });

  test('keeps the profile behind a sign-in', async () => {
    const res = await app.get('/profile');

    expect(res.status).toBe(302);
  });
});

/**
 * The stylesheet link has to name the path the asset build actually writes.
 * It shipped pointing at /app.css while the build produced public/css/app.css,
 * so every page rendered unstyled with a 404 in the log — a failure that looks
 * like a CSS problem and is really a one-segment path mismatch.
 */
describe('assets', () => {
  test('links the stylesheet where the build writes it', async () => {
    const res = await app.get('/');

    res.assertSee('/css/app.css');
  });
});
