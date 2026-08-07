/**
 * TenancyProvider — wires @zerotal/tenancy into the Zerotal application.
 *
 * 1. Binds the tenancy config to the container under the `'tenancy'` key.
 * 2. Configures TenancyMiddleware with the resolved config so it can resolve
 *    tenants without needing the container on every request.
 *
 * @example
 * // bootstrap/app.ts
 * import { TenancyProvider } from '@zerotal/tenancy';
 *
 * Application.create()
 *   .register([TenancyProvider, /* … *\/])
 *   .use([TenancyMiddleware]);   // or attach per-route-group
 */

import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import { registerConnectionResolver } from "@zerotal/orm";
import { TenancyMiddleware } from "../TenancyMiddleware.ts";
import { TenancyNotConfiguredError, TenancyConfigError } from "../errors.ts";
import { Tenancy } from "../Tenancy.ts";
import { TenantManager } from "../TenantManager.ts";
import { TenantModel } from "../TenantModel.ts";
import { TenantContext } from "../TenantContext.ts";
import { tenantSchemaConcern } from "../tenantSchemaConcern.ts";
import {
  _pendingTenantable,
  registerTenantScoping,
  _markTenantProviderBooted,
} from "../Tenantable.ts";
import type { MultiDbTenant, TenancyConfigShape } from "../types.ts";

export class TenancyProvider extends ServiceProvider {
  static override provides = ["tenancy"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "worker", "test", "repl"];

  /**
   * Supply the tenancy configuration.
   * Call this *before* registering TenancyProvider:
   *
   *   TenancyProvider.withConfig(tenancyConfig({ … }));
   *   Application.create().register([TenancyProvider]);
   */
  static withConfig(config: TenancyConfigShape): typeof TenancyProvider {
    TenancyProvider._config = config;
    return TenancyProvider;
  }

  private static _config?: TenancyConfigShape;

  /**
   * Resolve the active config: an explicit {@link withConfig} call wins, otherwise
   * the auto-discovered `config/tenancy.ts` (loaded into the container's ConfigManager
   * under the `tenancy` namespace). This is what makes the common setup a two-liner —
   * register the provider and drop a `config/tenancy.ts`, no `withConfig()` needed.
   */
  private _resolveConfig(): TenancyConfigShape | undefined {
    if (TenancyProvider._config) return TenancyProvider._config;
    const config = this.app.container.makeSync("config") as {
      get(key: string): unknown;
    };
    const fromFile = config.get("tenancy") as TenancyConfigShape | undefined;
    if (fromFile && Array.isArray(fromFile.resolvers)) {
      TenancyProvider._config = fromFile;
      return fromFile;
    }
    return undefined;
  }

  /** The per-tenant connection pool for the multi-database strategy (null otherwise). */
  private static _manager?: TenantManager;

  override onRegister(): void {
    const config = this._resolveConfig();
    if (!config) {
      throw new TenancyNotConfiguredError(
        "No tenancy config found. Add a `config/tenancy.ts` (default export of TenancyConfig({ … })) " +
          "or call TenancyProvider.withConfig(TenancyConfig({ … })) before registering the provider.",
      );
    }
    if (config.strategy === "multi-database" && !config.connect) {
      throw new TenancyConfigError(
        "The multi-database strategy requires a `connect` factory in TenancyConfig({ … }) " +
          "so each tenant's database connection can be opened.",
      );
    }
    // The `tenancy` binding is the Tenancy service behind the `Tenant` facade.
    this.app.container.singleton("tenancy", () => new Tenancy());
    // Provision the `tenants` + `tenant_members` tables on boot — no migration needed.
    this.app.registerConcern?.(tenantSchemaConcern);
  }

  override async onBooted(): Promise<void> {
    const config = this._resolveConfig() as TenancyConfigShape;
    TenancyMiddleware.configure(config);
    // Pre-resolve the `tenancy` singleton so the `Tenant` facade works at request time —
    // `createFacade` uses `makeSync`, which only returns an already-instantiated singleton.
    await this.app.container.make("tenancy");
    // Register the resolver/boundary middleware globally so every request is tenant-aware
    // (Auth.user(), model queries, cache, storage). It is lenient — routes that *require* a
    // tenant opt into EnsureTenancyMiddleware. Registered after AuthProvider's
    // PersistUserMiddleware (its onBooting runs first) so AuthResolver can read `http.user`.
    this.app.useOnce(TenancyMiddleware as never);
    for (const cls of _pendingTenantable) {
      registerTenantScoping(cls);
    }
    if (config.strategy === "multi-database" && config.connect) {
      await this._wireMultiDatabase(config.connect);
    }
    _markTenantProviderBooted();
  }

  /**
   * Make the multi-database strategy seamless: route every model query inside a tenant
   * boundary to that tenant's connection via the ORM's context resolver. App models stay
   * plain — `Project.all()` "just works". The internal `TenantModel` is exempt (the tenant
   * registry lives in the central/default database).
   */
  private async _wireMultiDatabase(
    connect: NonNullable<TenancyConfigShape["connect"]>,
  ): Promise<void> {
    const manager = new TenantManager({ connect });
    TenancyProvider._manager = manager;

    registerConnectionResolver((ModelClass) => {
      if (ModelClass === TenantModel) return null; // registry → central DB
      const tenant = TenantContext.tryGet();
      return tenant ? manager.connectionFor(tenant as MultiDbTenant) : null;
    });

    // Drop a tenant's pooled connection when the tenant is deleted.
    const tenancy = await this.app.container.make<Tenancy>("tenancy");
    tenancy.onTenantDeleted((tenant) => manager.evict(tenant));
  }
}
