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
  app = await createTestApp(() => import('../bootstrap/app.ts').then((m) => m.default));
});

afterAll(() => app.close());

describe('scaffold', () => {
  test('boots and renders the welcome page', async () => {
    const res = await app.get('/');

    res.assertOk();
    // assertSeeText ignores the markup between the words, so a class change or a
    // wrapping element does not fail a test about what the page says.
    res.assertSeeText('Build server-driven apps with Zerotal');
  });

  test('serves the other views', async () => {
    (await app.get('/about')).assertOk();
    (await app.get('/contact')).assertOk();
  });

  test('serves the JSON routes', async () => {
    const res = await app.get('/api');
    res.assertOk().assertJson({ message: 'Hello, API!' });

    const withParam = await app.get('/api/42');
    withParam.assertJsonPath('id', '42');
  });

  test('answers HEAD on the home route, as probes and load balancers do', async () => {
    const res = await app.head('/');
    expect(res.status).toBeLessThan(400);
  });

  test('returns 404 for an unregistered path', async () => {
    (await app.get('/definitely-not-a-route')).assertNotFound();
  });
});
