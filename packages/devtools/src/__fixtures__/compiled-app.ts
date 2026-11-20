/**
 * An app with the inspector on, for `clientAssets.test.ts` to compile with
 * `bun build --compile` and run from a directory with no `node_modules` above it.
 *
 * It prints the port it is listening on as one JSON line, then serves until it
 * is killed. Run it with `APP_ENV=development`, or the inspector stays off.
 */
import { Application, Router, type HttpContext } from "@zerotal/core";
import { DevtoolsProvider } from "../provider/DevtoolsProvider.ts";

const app = Application.create({ env: "web" }).register([DevtoolsProvider]);
await app.boot();
Router.get(
  "/page",
  class Page {
    handle(http: HttpContext): void {
      http.response = new Response("<!doctype html><html><head></head><body><p>page</p></body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  },
  "handle",
);
await app.start(0);

const server = (app as unknown as { _static?: { port: number } })._static;
console.log(JSON.stringify({ port: server?.port }));
