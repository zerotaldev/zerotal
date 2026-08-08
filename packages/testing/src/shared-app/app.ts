/**
 * A minimal bootstrap module shared by the two regression files beside it.
 *
 * The point is that this module is *cached*: both files import it, so both get the
 * same Application instance — which is what `createTestApp` keys its per-process
 * sharing on.
 */
import { Application, Router } from "@zerotal/core";
import { DatabaseProvider } from "@zerotal/orm";

const app = Application.create({ env: "test" })
  .register([DatabaseProvider])
  .useConfig({ database: { driver: "sqlite", url: ":memory:" } });

Router.get("/ping", () => new Response("pong"));

export default app;
