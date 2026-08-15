/**
 * Compile-time guard for typed route names. Not imported by anything — its job
 * is to fail `tsc` if the types stop working.
 *
 * `routes.generated.ts` types `route()` by augmenting `RouteRegistry` in
 * `@zerotal/core`, but the interface is *declared* in `@zerotal/core`'s
 * `router/registry.ts` and only re-exported from the barrel. Augmentation
 * through a re-export does merge with the original declaration — which is what
 * lets the browser entry (`@zerotal/core/routes`) read the same registry from a
 * different entry point — but that is a subtle enough guarantee that it should
 * be asserted rather than assumed. A refactor that broke it would not fail any
 * runtime test: `route()` would keep working and quietly stop being checked,
 * which is the failure this whole feature exists to prevent.
 *
 * Each `@ts-expect-error` below is the real assertion: it fails the build if the
 * line it marks *stops* being an error.
 */
import { route as clientRoute, hasRoute } from "@zerotal/core/routes";
import { route as serverRoute } from "@zerotal/core";
import "./routes.generated.ts";

// ── A registered name resolves on both entry points ──────────────────────────
clientRoute("home");
serverRoute("home");

// ── An unregistered name is a compile error on both ──────────────────────────
// @ts-expect-error unknown route name
clientRoute("definitely.not.a.route");
// @ts-expect-error unknown route name
serverRoute("definitely.not.a.route");

// ── A required :param is enforced on both ────────────────────────────────────
// @ts-expect-error missing required param `post`
clientRoute("admin.posts.edit", {});
// @ts-expect-error missing required param `post`
serverRoute("admin.posts.edit", {});

clientRoute("admin.posts.edit", { post: 1 });
serverRoute("admin.posts.edit", { post: "slug" });

// ── A param the pattern has no segment for is rejected, not silently queried ──
// @ts-expect-error `tab` is not a segment of /admin/posts/:post/edit
clientRoute("admin.posts.edit", { post: 1, tab: "meta" });

// Query values belong in the third argument, and are unconstrained.
clientRoute("admin.posts.edit", { post: 1 }, { tab: "meta" });

// ── The runtime escape hatch stays untyped by design ─────────────────────────
clientRoute.dynamic("resolved.at.runtime", { any: "value" });
hasRoute("any string is a valid question");
