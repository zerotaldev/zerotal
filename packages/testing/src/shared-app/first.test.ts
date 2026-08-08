/**
 * Half of a two-file regression (see `second.test.ts`).
 *
 * Bun runs a whole suite in one process and the ORM connection is process-global, so
 * this file's `afterAll(() => app.close())` used to close the connection the *next*
 * file depended on. The file that failed was entirely correct in isolation — the
 * failure was caused by an unrelated file that happened to run first.
 *
 * Both files use the scaffolded shape exactly: `createTestApp` with an inline arrow
 * (a different function object each time) around a cached bootstrap module.
 */
import { beforeAll, afterAll, test, expect } from "bun:test";
import { createTestApp, type TestApp } from "../index.ts";
import { DB } from "@zerotal/orm";

let app: TestApp;

beforeAll(async () => {
  app = await createTestApp(() => import("./app.ts").then((m) => m.default));
});

afterAll(() => app.close());

test("the first file boots the app and can reach the database", async () => {
  await DB.raw("CREATE TABLE IF NOT EXISTS first_table (id INTEGER)");

  expect((await app.get("/ping")).status).toBe(200);
});
