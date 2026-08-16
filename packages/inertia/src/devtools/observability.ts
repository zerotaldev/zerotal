/**
 * Inertia → DevTools panel bridge.
 *
 * The recorder already resolves everything worth showing about an Inertia
 * request — which prop came from which wrapper, what kind of request it was,
 * which batch it belongs to. All of it went to the browser-extension read API
 * and nowhere else, so a developer running the in-page panel could not see a
 * single prop, and a developer running the extension could not see a single SQL
 * query. The two halves described the same request and never met.
 *
 * This is the fan-out that joins them. The entry is recorded against the same
 * `HttpContext` the SQL was, so the panel's own correlation puts both on one
 * trace with no key to match — "is this page slow because of the query or the
 * deferred prop" becomes one view rather than two tools.
 *
 * Deliberately a fan-out and not a migration: {@link DevtoolsEntry} and its read
 * API are a published contract, and this package keeps serving them whether or
 * not devtools is installed. Nor does installing devtools become a dependency —
 * the sink is resolved by container key through a local structural interface,
 * exactly as every other package's bridge does it, so `@zerotal/inertia` imports
 * `@zerotal/devtools` nowhere.
 *
 * ## This package's cast boundary
 *
 * Listed under `boundaries` in `cast-baseline.json`. One cast lives here and it
 * is the price of the independence described above: `devtools.trace` is not in
 * `ContainerBindings` from this package, because the augmentation that adds it
 * belongs to the package this one deliberately does not depend on. Typing the
 * lookup properly would mean taking that dependency, which would cost more than
 * the cast saves.
 *
 * The invariant it rests on: a missing binding is the ordinary case — devtools is
 * not installed, or the app is in production — and `tryMake` returning
 * `undefined` is handled on the next line.
 */
import type { Application, HttpContext } from "@zerotal/core";
import type { DevtoolsEntry } from "./types.ts";

/** The subset of the devtools trace sink this bridge calls (bound as `devtools.trace`). */
interface DevtoolsSink {
  channel(descriptor: {
    id: string;
    label: string;
    badge?: string;
    title?: string;
    meta?: string[];
    warn?: string;
    order?: number;
    render?: "rows" | "tree" | "table" | "kv" | "grouped";
    treeField?: string;
    treeBadge?: string;
    groupBy?: string;
    flags?: string[];
    traceGroup?: string;
  }): void;
  record(ctx: object, channel: string, entry: Record<string, unknown>): void;
}

/** The sink, once the provider has found one. Null when devtools is not installed. */
let _sink: DevtoolsSink | null = null;

/**
 * Point the recorder at the devtools panel, if there is one.
 *
 * Called from `InertiaProvider` when the recorder is enabled. Returns a disposer
 * that detaches the bridge; call it from the provider's teardown so a suite that
 * boots several apps does not leave one app's sink wired to the next one's.
 *
 * @param app - The application, for the container lookup.
 */
export function installInertiaObservability(app: Application): () => void {
  // Not in `ContainerBindings` from here — the binding is declared by the package
  // that owns it, and this one deliberately depends on none of them. A missing
  // binding is the ordinary case, not an error: it means devtools is not
  // installed, or the app is in production, and neither is this package's business.
  const sink = app.container.tryMake("devtools.trace" as never) as DevtoolsSink | undefined;
  if (!sink) return () => {};

  // Declared once, as data. The panel renders the prop map as a tree, badges each
  // prop with the wrapper that produced it, and folds a visit together with the
  // deferred loads it triggered — and devtools ships no Inertia-specific code to
  // do any of it.
  sink.channel({
    id: "inertia",
    label: "Inertia",
    badge: "requestType",
    title: "component",
    meta: ["route", "url", "status", "props", "serverTimingMs"],
    order: 15,
    render: "tree",
    treeField: "propMeta",
    treeBadge: "inertiaType",
    flags: ["shared", "once", "rescued", "reset", "deepMerge"],
    // A partial reload and the visit that caused it are one thing the developer
    // did; `batchId` is what the protocol already uses to say so.
    traceGroup: "batchId",
  });

  _sink = sink;
  return () => {
    _sink = null;
  };
}

/**
 * Push one finished entry onto the panel's `inertia` channel.
 *
 * A no-op when no sink was found, so the recorder calls it unguarded.
 *
 * The channel entry is a *view* of the protocol entry, not the entry itself: the
 * panel wants flat, named fields it can badge and sort, while `DevtoolsEntry` is
 * shaped by the wire contract. Copying the handful of fields worth showing keeps
 * the two from constraining each other — and keeps the request headers and
 * captured bodies out of a second store that has its own retention.
 *
 * @param http - The context the entry was recorded on; the join to its trace.
 * @param entry - The finished protocol entry.
 */
export function shareEntryWithDevtools(http: HttpContext, entry: DevtoolsEntry): void {
  const sink = _sink;
  if (!sink) return;

  const meta = entry.__meta;
  const propMeta = entry.props;

  sink.record(http, "inertia", {
    requestType: meta.requestType,
    component: meta.component ?? "—",
    // The name when the route has one, the pattern when it does not: a named
    // route is what the developer wrote, and a bare URI is what is left.
    route: entry.route.name ?? entry.route.uri,
    url: meta.url,
    status: meta.status,
    props: Object.keys(propMeta).length,
    serverTimingMs: meta.serverTimingMs,
    batchId: meta.batchId,
    // The id the extension knows this entry by, and the value of the
    // `X-Inertia-Devtools-Id` response header — so a row in the panel and a row
    // in the extension can be recognised as the same request.
    entryId: meta.id,
    componentPath: entry.componentPath,
    propMeta,
    ...(meta.redirectLocation ? { redirectLocation: meta.redirectLocation } : {}),
  });
}
