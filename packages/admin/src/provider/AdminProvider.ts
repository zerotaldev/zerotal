/**
 * AdminProvider — wires the admin panel into the application.
 *
 * Just register `AdminProvider`; it depends on `FlowProvider` (which installs the
 * `Router.flow()` macro and the WebSocket runtime the pages rely on), so Flow is
 * pulled in automatically and guaranteed to boot first — you do not have to list it:
 *
 *   import { AdminProvider } from "@zerotal/admin";
 *   export default [AdminProvider];   // FlowProvider comes along via dependsOn
 *
 * On boot it loads `app/admin.ts` (where you call `Panel.register(...)`), then
 * mounts a Dashboard page plus one List page per registered resource under the
 * configured path (default `/admin`).
 *
 * It also publishes the panel as a *host*: `admin.panel` is bound during
 * `onRegister`, so any provider can contribute pages, widgets, nav entries and
 * search providers from its own `onBooting` without depending on this package.
 * Routes are mounted in `onBooted`, once every contribution is in.
 */
import { ServiceProvider, Router, FrameworkEvents } from "@zerotal/core";
import type { ModelChanged } from "@zerotal/orm";
import type { AppEnvironment, MiddlewareClass, HttpContext } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { FlowProvider } from "@zerotal/flow";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";
import { pagePath } from "../PanelInstance.ts";
import { AdminGuardMiddleware } from "./AdminGuardMiddleware.ts";
import { AdminAbilityMiddleware } from "./AdminAbilityMiddleware.ts";
import type { AdminPanelHost } from "../plugin.ts";
import type { AdminConfigShape } from "../config.ts";
import { makeDashboardPage } from "../pages/DashboardPage.tsx";
import { makeSearchPage } from "../pages/SearchPage.tsx";
import { makeNotificationsPage } from "../pages/NotificationsPage.tsx";
import { makeMediaPage } from "../pages/MediaPage.tsx";
import { makeRolesPage } from "../pages/RolesPage.tsx";
import { makeResourceListPage } from "../pages/ResourceListPage.tsx";
import { makeRecordViewPage } from "../pages/RecordViewPage.tsx";
import { ResourceFormPage, registerResourceForm } from "../pages/ResourceFormPage.tsx";
import { makeConsolePage } from "../pages/ConsolePage.tsx";
import { makeResourceForm } from "../form/index.ts";
import { forgetTabCounts } from "../support/countCache.ts";
import { hostedPage } from "../support/hostPage.ts";
import { frameworkLog } from "@zerotal/core/logger";

declare module "@zerotal/core" {
  interface ContainerBindings {
    /** The panel's contribution surface — see `plugin.ts`. */
    "admin.panel": AdminPanelHost;
  }
}

export class AdminProvider extends ServiceProvider {
  static override provides = ["admin.panel"] as const;
  // The panel mounts HTTP routes via Flow's `Router.flow()` macro, so Flow must
  // boot first — declared here so registering AdminProvider pulls it in automatically.
  static override dependsOn = [FlowProvider];

  // The panel mounts HTTP routes via Flow's `Router.flow()` macro, so serving
  // only happens where Flow serves. `console` boots this provider anyway, but
  // solely to register `make:admin-resource` — see `_servesHttp()`, which returns
  // before any route mounting there.
  static override environments: AppEnvironment[] = ["web", "test", "console"];

  override onRegister(): void {
    // Merge config/admin.ts (if present) into the panel configuration. This runs
    // before any provider's onBooting, so the `plugins` opt-out is already in
    // place by the time a contributor asks whether it is enabled — which is why
    // that flag belongs in config/admin.ts rather than app/admin.ts.
    try {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const adminCfg = config.get<Partial<AdminConfigShape>>("admin");
      if (adminCfg) Panel.configure(adminCfg);
    } catch {
      // No config bound (e.g. in isolated tests) — defaults apply.
    }

    // Publish the contribution surface. Bound here, in the registration phase, so
    // every other provider can reach it from onBooting regardless of boot order —
    // contributors deliberately do not (and must not) depend on this provider.
    this.app.container.singleton("admin.panel", () => Panel.host());
  }

  private _disposeCountInvalidation: (() => void) | undefined;

  override async onBooting(): Promise<void> {
    // CLI generators first: `console` boots this provider only to register them,
    // and returns before any of the serving work below.
    this._registerCommands();
    if (!this._servesHttp()) return;

    await this._autodiscover();
    this._watchModelChanges();
  }

  /**
   * True only where the panel actually serves. `console`/`repl` boot this
   * provider just for its generators — there is no `Router.flow()` there, and
   * nothing to serve.
   */
  private _servesHttp(): boolean {
    const env = this.app.environment;
    return env !== "console" && env !== "repl";
  }

  /**
   * Register the panel's generator. Lazy, so the command's module — and the stub
   * text it carries — stays out of the serving path.
   */
  private _registerCommands(): void {
    const runner = this.app.container.tryMake("commands");
    if (!runner) return;
    runner.registerLazy("make:admin-resource", () =>
      import("../commands/MakeAdminResourceCommand.ts").then((m) => m.MakeAdminResourceCommand),
    );
  }

  /**
   * Mount the panel's routes.
   *
   * Deferred to `onBooted` because contributions arrive during the booting phase:
   * every provider's `onBooting` has run by now, so the page registry is complete
   * and each contributed page gets a route.
   */
  override async onBooted(): Promise<void> {
    if (!this._servesHttp()) return;
    for (const panel of Panel.all()) {
      this._registerRoutes(panel);
      await this._registerAuthRoutes(panel);
    }
  }

  /**
   * Mount a panel's auth pages when it called `auth({ enabled: true })`. Loaded
   * via a dynamic import so the `@zerotal/auth` dependency stays optional
   * otherwise.
   */
  private async _registerAuthRoutes(panel: PanelInstance): Promise<void> {
    if (!panel.authConfig()) return;
    try {
      const { registerAuthRoutes } = await import("../auth/register.ts");
      registerAuthRoutes(panel.base(), this._effectiveGuard(panel.config().middleware));
    } catch (err) {
      frameworkLog("admin").warn(
        "Auth pages require @zerotal/auth to be installed",
        undefined,
        err,
      );
    }
  }

  /**
   * Invalidate a resource's cached tab counts whenever one of its records is
   * created / updated / deleted — wherever that write originates (the admin,
   * a controller, a seeder). Matches by model name, then backing table.
   */
  private _watchModelChanges(): void {
    this._disposeCountInvalidation = FrameworkEvents.on<ModelChanged>("ModelChanged", (e) => {
      for (const panel of Panel.all()) {
        for (const resource of panel.resources()) {
          const model = resource.model as { name?: string; table?: string } | undefined;
          if (model?.name === e.model || model?.table === e.table) {
            void forgetTabCounts(resource.getSlug());
          }
        }
      }
    });
  }

  override async onStopping(): Promise<void> {
    this._disposeCountInvalidation?.();
    this._disposeCountInvalidation = undefined;
  }

  /**
   * Load the app's panel wiring so its `Panel.register(...)` /
   * `Panel.configure(...)` calls run.
   *
   * A single `app/admin.ts` is enough for a handful of resources. Past that,
   * apps split the panel into `app/admin/` — a file per resource and an
   * `index.ts` that registers them — so both spellings are honoured, the file
   * first.
   */
  private async _autodiscover(): Promise<void> {
    const candidates = [`${process.cwd()}/app/admin.ts`, `${process.cwd()}/app/admin/index.ts`];
    for (const file of candidates) {
      try {
        if (!(await Bun.file(file).exists())) continue;
        await import(file);
        return;
      } catch (err) {
        frameworkLog("admin").warn(`Failed to load ${file}`, { file }, err);
        return;
      }
    }
  }

  /**
   * Resolve the guard applied to panel routes. An explicit, non-empty
   * `middleware` from config/admin.ts is used as-is. Otherwise the panel is
   * default-denied in production-like environments via {@link AdminGuardMiddleware}
   * — the secure default is closed. Set an explicit pass-through middleware to
   * intentionally expose the panel without auth.
   */
  private _effectiveGuard(configured: MiddlewareClass[] | undefined): MiddlewareClass[] {
    if (configured && configured.length > 0) return configured;
    return [AdminGuardMiddleware];
  }

  /** Mount the dashboard + a List page per resource under one panel's path. */
  private _registerRoutes(panel: PanelInstance): void {
    const path = panel.base();
    // Guard every panel route with the configured middleware. When none is set,
    // fall back to a fail-closed default guard that denies the panel in any
    // production-like environment — so an app that forgets to configure auth
    // does not silently expose full CRUD. See _effectiveGuard().
    const guard: MiddlewareClass[] = this._effectiveGuard(panel.config().middleware);

    const flow = (
      Router as unknown as {
        flow?: (p: string, page: unknown, mw?: MiddlewareClass[]) => unknown;
      }
    ).flow;
    if (typeof flow !== "function") {
      throw new Error(
        "[Zerotal Admin] Router.flow() is unavailable — register FlowProvider before AdminProvider.",
      );
    }

    Router.group({ prefix: path, middleware: guard }, () => {
      flow("", makeDashboardPage(panel));
      flow("/search", makeSearchPage(panel));
      flow("/notifications", makeNotificationsPage(panel));
      // Mounted only when the panel has somewhere to catalogue files; without a
      // provider the page would be a permanent empty state.
      if (panel.mediaProvider()) flow("/media", makeMediaPage(panel));
      if (panel.roleProvider()) flow("/roles", makeRolesPage(panel));

      // Leaving an impersonation. A plain GET rather than a page: it does one
      // thing and sends you back, so there is nothing to render. Inside the
      // group, so it carries the panel's prefix and guard already.
      class StopImpersonating {
        async handle(http: HttpContext): Promise<void> {
          const { stopImpersonating } = await import("../impersonation.ts");
          await stopImpersonating();
          http.redirect(path || "/");
        }
      }
      Router.get("/stop-impersonating", StopImpersonating, "handle");

      // Custom pages — the app's own AdminPage subclasses and anything packages
      // contributed. Each carries its declared ability as a second guard on top
      // of the panel-wide one, so the route enforces exactly what the sidebar
      // used to decide whether to draw the link.
      for (const page of panel.registeredPages()) {
        const pageGuard: MiddlewareClass[] = [
          AdminAbilityMiddleware.with({ ability: page.ability }),
        ];
        // A clustered page also answers to its cluster's ability.
        if (page.cluster?.ability) {
          pageGuard.push(AdminAbilityMiddleware.with({ ability: page.cluster.ability }));
        }
        const hosted = hostedPage(page.page);
        const path = pagePath(page);
        flow(`/${path}`, hosted, pageGuard);
        for (const param of page.routeParams) {
          flow(`/${path}/${param.replace(/^\//, "")}`, hosted, pageGuard);
        }
      }

      // Consoles — contributed table-and-action pages, rendered by the panel from
      // the description the package handed over.
      for (const console of panel.consoles()) {
        flow(`/${console.slug}`, makeConsolePage(console, panel), [
          AdminAbilityMiddleware.with({ ability: console.ability }),
        ]);
      }

      for (const resource of panel.resources()) {
        const slug = resource.getSlug();
        const model = resource.getModelName();
        // Where this resource's pages live: bare, inside a cluster, or under a
        // parent record. The resource owns that decision — see `routePath()`.
        const path = `/${resource.routePath()}`;
        // A cluster's ability gates every route inside it, so a member never has
        // to restate it. Resources carry their own record-level `can()` too.
        const clusterGuard: MiddlewareClass[] = resource.cluster?.ability
          ? [AdminAbilityMiddleware.with({ ability: resource.cluster.ability })]
          : [];

        const fields = resource.isEditable() ? resource.form() : [];
        if (resource.isEditable()) {
          const create = makeResourceForm(fields, "create", `${model}CreateForm`);
          const edit = makeResourceForm(fields, "edit", `${model}EditForm`);
          // One shared page class serves every resource's Create/Edit route; it
          // resolves which panel/resource/mode it is serving from the URL via
          // this registry.
          registerResourceForm(panel.id, slug, {
            resource,
            create: { FormClass: create.FormClass, fields: create.fields },
            edit: { FormClass: edit.FormClass, fields: edit.fields },
          });
        }

        // A singular resource is one row: its index *is* the edit form, and it
        // has no list, no create page and no id segment.
        if (resource.singular) {
          if (resource.isEditable()) flow(path, ResourceFormPage, clusterGuard);
          continue;
        }

        flow(path, makeResourceListPage(resource, panel), clusterGuard);

        // The static `/create` route is registered before the `:id` view so it
        // wins over the param segment.
        if (resource.isEditable()) {
          flow(`${path}/create`, ResourceFormPage, clusterGuard);
          flow(
            `${path}/:${resource.primaryKey}`,
            makeRecordViewPage(resource, panel),
            clusterGuard,
          );
          flow(`${path}/:${resource.primaryKey}/edit`, ResourceFormPage, clusterGuard);
        } else {
          flow(
            `${path}/:${resource.primaryKey}`,
            makeRecordViewPage(resource, panel),
            clusterGuard,
          );
        }
      }
    });
  }
}
