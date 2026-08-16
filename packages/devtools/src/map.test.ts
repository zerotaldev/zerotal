/**
 * The framework map: reading the registries the app already keeps.
 *
 * The one surface here that is not a plain read is the config, and it is the one
 * that matters — exposing config is how a debugging tool leaks a database
 * password.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Router, FrameworkEvents, Emitter } from "@zerotal/core";
import { configTree, eventRows, routeRows } from "./map.ts";

class Handler {}

beforeEach(() => {
  Router.reset();
  FrameworkEvents.clear();
});
afterEach(() => {
  Router.reset();
  FrameworkEvents.clear();
});

describe("routeRows", () => {
  it("flattens the router's registry, sorted by path then method", () => {
    // Registration order is an implementation detail of which file loaded first;
    // a list you scan for "is /posts/:id there" wants the paths together.
    Router.post("/posts", Handler as never, "store", []);
    Router.get("/about", Handler as never, "show", []);
    Router.get("/posts", Handler as never, "index", []);

    expect(routeRows().map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /about",
      "GET /posts",
      "POST /posts",
    ]);
  });

  it("carries the route name, resolved from the reverse map", () => {
    Router.get("/posts/:id", Handler as never, "show", []).name("posts.show");
    expect(routeRows()[0]!.name).toBe("posts.show");
  });

  it("leaves the name empty rather than inventing one", () => {
    Router.get("/anon", Handler as never, "index", []);
    expect(routeRows()[0]!.name).toBe("");
  });

  it("renders the handler as Controller@action", () => {
    Router.get("/x", Handler as never, "index", []);
    expect(routeRows()[0]!.handler).toBe("Handler@index");
  });

  it("is empty when nothing is registered", () => {
    expect(routeRows()).toEqual([]);
  });
});

describe("configTree", () => {
  it("masks anything whose key reads as a secret, at any depth", () => {
    // Including a bare `key`: `app.key` is the application's encryption key, and
    // the shared list only covers `api_key`/`private_key` because a *column*
    // named `key` is usually a lookup key. Config gets the stricter rule.
    const out = configTree(
      {
        app: { name: "Acme", key: "base64:supersecret" },
        database: { connections: { pg: { host: "localhost", password: "hunter2" } } },
      },
      {},
    ) as Record<string, Record<string, unknown>>;

    expect(out["app"]!["name"]).toBe("Acme");
    expect(out["app"]!["key"]).toBe("‹redacted›");
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(JSON.stringify(out)).not.toContain("supersecret");
  });

  it("honours the app's allow list, so it means the same thing here as elsewhere", () => {
    const out = configTree({ mail: { token: "shown" } }, { allow: ["token"] }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out["mail"]!["token"]).toBe("shown");
  });

  it("keeps ordinary values readable", () => {
    const out = configTree({ app: { debug: true, port: 3000 } }, {}) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out["app"]).toEqual({ debug: true, port: 3000 });
  });

  it("renders a function rather than walking into it", () => {
    const out = configTree({ devtools: { gate: () => true } }, {}) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out["devtools"]!["gate"]).toBe("‹fn›");
  });

  it("survives a cyclic config without throwing", () => {
    const node: Record<string, unknown> = { name: "root" };
    node["self"] = node;
    expect(() => JSON.stringify(configTree({ node }, {}))).not.toThrow();
  });

  it("descends deeper than a trace entry does", () => {
    // Config is nested by design; a namespace truncated three levels in is a
    // namespace you cannot read.
    const deep = { a: { b: { c: { d: { e: { f: { g: "leaf" } } } } } } };
    expect(JSON.stringify(configTree(deep, {}))).toContain("leaf");
  });
});

describe("eventRows", () => {
  it("merges application listeners and framework subscribers into one list", () => {
    // A developer asking "what reacts to this" does not care which bus it is on.
    class OrderPlaced {}
    class SendReceipt {
      handle(): void {}
    }
    const emitter = new Emitter();
    emitter.on(OrderPlaced, SendReceipt as never);
    FrameworkEvents.on("QueryExecuted", () => {});

    const rows = eventRows(emitter);
    const app = rows.find((r) => r.event === "OrderPlaced");
    const framework = rows.find((r) => r.event === "QueryExecuted");

    expect(app).toMatchObject({ listeners: "SendReceipt", source: "application" });
    expect(framework?.source).toBe("framework");
    expect(framework?.listeners).toContain("1 subscriber");
  });

  it("says 'subscribers' for more than one", () => {
    FrameworkEvents.on("QueryExecuted", () => {});
    FrameworkEvents.on("QueryExecuted", () => {});
    expect(eventRows(undefined)[0]!.listeners).toBe("2 subscribers");
  });

  it("copes with no emitter at all", () => {
    // A console process has no `events` binding.
    expect(eventRows(undefined)).toEqual([]);
  });

  it("is sorted, so two reads are comparable", () => {
    FrameworkEvents.on("ZebraEvent", () => {});
    FrameworkEvents.on("AlphaEvent", () => {});
    expect(eventRows(undefined).map((r) => r.event)).toEqual(["AlphaEvent", "ZebraEvent"]);
  });
});
