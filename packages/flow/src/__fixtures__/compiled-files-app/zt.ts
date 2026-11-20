/**
 * An app with its own config, pages and middleware on disk, for `compile.test.ts` to
 * build with `bun zt compile` and run from a directory that holds none of them.
 *
 * It prints the port it is listening on as one JSON line, then serves until it is killed.
 */
import { Application, Router, basePath, config, type HttpContext } from "@zerotal/core";
import { configLoader } from "@zerotal/core/config";
import { FlowProvider } from "../../provider/FlowProvider.ts";

const loaded = configLoader("./config");
const app = Application.create({ env: "web", providers: [FlowProvider] }).fileBasedRouting({
  web: basePath("app/flow/pages"),
});
await app.boot();

Router.get(
  "/facts",
  class Facts {
    handle(http: HttpContext): void {
      http.response = Response.json({
        config: config("probe.message"),
        configLoader: loaded.get("probe.message"),
      });
    }
  },
  "handle",
);
await app.start(0);

const server = (app as unknown as { _static?: { port: number } })._static;
console.log(JSON.stringify({ port: server?.port }));
