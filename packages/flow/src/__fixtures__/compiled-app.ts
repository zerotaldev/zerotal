/**
 * A Flow app reduced to what serving the client runtime needs, for
 * `clientAssets.test.ts` to compile with `bun build --compile` and run from a
 * directory with no `node_modules` anywhere above it.
 *
 * It prints the port it is listening on as one JSON line, then serves until it
 * is killed.
 */
import { Application, Router, type HttpContext } from "@zerotal/core";
import { FlowProvider } from "../provider/FlowProvider.ts";
import { Component } from "../Component.ts";
import { flowEnhanceTag } from "../enhanceTag.ts";
import type { HtmlNode } from "../jsx-runtime.ts";

class ProbePage extends Component {
  override async render(): Promise<HtmlNode> {
    return { html: `<p id="probe">compiled</p>` };
  }
}

const app = Application.create({ env: "web", providers: [FlowProvider] });
await app.boot();
Router.flow("/probe", ProbePage);
Router.get(
  "/plain",
  class PlainPage {
    handle(http: HttpContext): void {
      http.response = new Response(`<!doctype html><head>${flowEnhanceTag()}</head><body></body>`, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  },
  "handle",
);
await app.start(0);

const server = (app as unknown as { _static?: { port: number } })._static;
console.log(JSON.stringify({ port: server?.port }));
