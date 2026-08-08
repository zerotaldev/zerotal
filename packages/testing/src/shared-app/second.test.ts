/**
 * The half that used to fail (see `first.test.ts`).
 *
 * Before `createTestApp` shared one app per process, this file died at its first
 * query with "[Zerotal ORM] No database connection. Is DatabaseProvider registered?"
 * — because the previous file's teardown had already closed it.
 */
import { beforeAll, afterAll, test, expect } from "bun:test";
import { createTestApp, type TestApp } from "../index.ts";
import { DB } from "@zerotal/orm";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp(() => import("./app.ts").then((m) => m.default));
});

afterAll(() => app.close());

test("a second file still has a live database connection", async () => {
  await DB.raw("CREATE TABLE IF NOT EXISTS second_table (id INTEGER)");

  expect((await app.get("/ping")).status).toBe(200);
});

test("and still serves requests through the shared app", async () => {
  const res = await app.get("/ping");

  expect(await res.text()).toBe("pong");
});
