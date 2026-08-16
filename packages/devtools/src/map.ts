/**
 * The application as it is, rather than as it just behaved.
 *
 * Every tab up to here reads the trace stream: what one request did. This reads
 * the framework's own registries — the routes it will match, the config it
 * resolved, what is in the container, which providers put it there, and what
 * listens to what. All of it existed already and all of it was CLI-only or
 * invisible, so the questions it answers ("is that route even registered", "who
 * bound `cache`", "does anything listen to `OrderPlaced`") were answered by
 * reading source.
 *
 * Nothing here is instrumented. It is a read of state the app is already
 * keeping, taken when the panel asks — which is also why it needs no store and
 * no retention: there is only ever one current answer.
 */
import { Router, FrameworkEvents } from "@zerotal/core";
import type { Application, Emitter } from "@zerotal/core";
import { isSensitiveName } from "./redaction.ts";
import { redactGraph } from "@zerotal/core/security";
import type { RedactionOptions } from "./redaction.ts";

/** One registered route, flattened for display. */
export interface RouteRow {
  method: string;
  path: string;
  name: string;
  handler: string;
  middleware: string;
}

/** One container binding. */
export interface BindingRow {
  token: string;
  kind: string;
  /** The provider that bound it, when boot recorded one. */
  provider: string;
}

/** One provider, in boot order. */
export interface ProviderRow {
  name: string;
  durationMs: number;
  bindings: number;
}

/** One event and what reacts to it. */
export interface EventRow {
  event: string;
  /** Application listener class names, or the handler count for a framework event. */
  listeners: string;
  source: "application" | "framework";
}

/** Everything the App section draws. */
export interface FrameworkMap {
  routes: RouteRow[];
  config: Record<string, unknown>;
  bindings: BindingRow[];
  providers: ProviderRow[];
  events: EventRow[];
  /** Wall-clock boot time, so the provider list has a total to be read against. */
  bootMs: number | null;
}

/** `[class PostController]` → `PostController`; a plain token passes through. */
function tokenName(token: unknown): string {
  if (typeof token === "string") return token;
  if (typeof token === "function") return token.name || "‹anonymous›";
  return String(token);
}

/**
 * Every registered route, newest framework state, sorted for reading.
 *
 * Sorted by path then method rather than by registration order: registration
 * order is an implementation detail of which file loaded first, and a list you
 * scan for "is `/posts/:id` there" wants the paths together.
 */
export function routeRows(): RouteRow[] {
  // `namedRoutes` is name → path; the panel wants the reverse.
  const nameByPath = new Map<string, string>();
  for (const [name, path] of Router.namedRoutes) nameByPath.set(path, name);

  return [...Router.routes.values()]
    .map((route) => ({
      method: route.method,
      path: route.path,
      name: nameByPath.get(route.path) ?? "",
      handler: `${route.controller?.name ?? "—"}@${route.action}`,
      middleware: route.middleware
        .map((m) => m.name)
        .filter(Boolean)
        .join(", "),
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * The resolved config, with anything that looks like a secret masked.
 *
 * Exposing config is how a debugging tool leaks a database password, so this is
 * the one surface here that is *not* a plain read. The same `isSensitiveName`
 * rule the rest of the package uses decides, which means an app's `allow` and
 * `deny` mean the same thing here as they do on the Queries tab — and it is a
 * deny-by-default rule, so a key nobody anticipated is masked rather than shown.
 */
export function configTree(
  all: Record<string, unknown>,
  redaction: RedactionOptions,
): Record<string, unknown> {
  // Stricter here than anywhere else in the package, deliberately. The shared
  // list masks `api_key` and `private_key` but not a bare `key` — reasonable for
  // a query binding, where a column called `key` is usually a lookup key, and
  // wrong for config, where `app.key` is the application's encryption key. Same
  // reasoning for `dsn`: a connection string is credentials with a hostname
  // attached. Config is the one place secrets are *supposed* to live, so it gets
  // the benefit of the doubt in the other direction.
  const strict: RedactionOptions = {
    ...redaction,
    deny: [...(redaction.deny ?? []), "key", "dsn"],
  };
  return redactGraph(all, {
    sensitive: (key) => isSensitiveName(key, strict),
    mask: "‹redacted›",
    circular: "‹circular›",
    tooDeep: "‹truncated›",
    // Deeper than a trace entry: config is nested by design and a namespace
    // truncated three levels in is a namespace you cannot read.
    maxDepth: 10,
    flatten: (value) => (typeof value === "function" ? "‹fn›" : undefined),
  }) as Record<string, unknown>;
}

/**
 * What is in the container, and who put it there.
 *
 * Provenance comes from the boot report rather than from the container, which
 * does not track it — see `Application.providerReport`.
 */
export function bindingRows(app: Application): BindingRow[] {
  const owner = new Map<string, string>();
  for (const provider of app.providerReport) {
    for (const token of provider.bindings) owner.set(token, provider.name);
  }

  return [...app.container.registry.entries()]
    .map(([token, binding]) => {
      const name = tokenName(token);
      return {
        token: name,
        kind: (binding as { kind?: string }).kind ?? "unknown",
        provider: owner.get(name) ?? "—",
      };
    })
    .sort((a, b) => a.token.localeCompare(b.token));
}

/** Providers in boot order, with what each cost. */
export function providerRows(app: Application): ProviderRow[] {
  return app.providerReport.map((p) => ({
    name: p.name,
    durationMs: p.durationMs,
    bindings: p.bindings.length,
  }));
}

/**
 * Application listeners and framework subscribers, in one list.
 *
 * Two different mechanisms — `Emitter.on()` for the app's own events,
 * `FrameworkEvents.on()` for the framework bus — and a developer asking "what
 * reacts to this" does not care which. The `source` column keeps them
 * distinguishable without splitting the answer in two.
 */
export function eventRows(emitter: Emitter | undefined): EventRow[] {
  const rows: EventRow[] = [];

  for (const { event, listeners } of emitter?.registrations() ?? []) {
    rows.push({ event, listeners: listeners.join(", "), source: "application" });
  }
  for (const { event, handlers } of FrameworkEvents.subscriptions()) {
    rows.push({
      event,
      listeners: `${handlers} subscriber${handlers === 1 ? "" : "s"}`,
      source: "framework",
    });
  }
  return rows.sort((a, b) => a.event.localeCompare(b.event));
}

/**
 * Read the whole map.
 *
 * Taken fresh on each request for it. The registries are small and static, and a
 * cached map is a map that disagrees with the app the moment a provider
 * registers a route late.
 */
export function buildFrameworkMap(app: Application, redaction: RedactionOptions): FrameworkMap {
  const config = app.container.tryMake("config");
  const emitter = app.container.tryMake("events") as Emitter | undefined;

  return {
    routes: routeRows(),
    config: configTree(
      (config as { all?: () => Record<string, unknown> } | undefined)?.all?.() ?? {},
      redaction,
    ),
    bindings: bindingRows(app),
    providers: providerRows(app),
    events: eventRows(emitter),
    bootMs: app.bootDurationMs ?? null,
  };
}
