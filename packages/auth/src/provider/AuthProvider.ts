import { ServiceProvider, HttpContext, ForbiddenError } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import type { AuthUser } from "../AuthUser.ts";
import { HashService } from "../HashService.ts";
import { installAuthObservability } from "../observability.ts";
import { GateService } from "../GateService.ts";
import { TwoFactorService } from "../TwoFactorService.ts";
import { PersistUserMiddleware } from "../PersistUserMiddleware.ts";
import { RememberMeMiddleware } from "../RememberMeMiddleware.ts";
import { defaultUserLoader } from "../authUserModel.ts";
import { warmLoginTiming } from "../facades/Auth.ts";
import type { AuthConfigShape } from "../config.ts";
import { policiesConcern } from "../conventions.ts";
import { authSchemaConcern } from "../authSchemaConcern.ts";
import { rbacSchemaConcern } from "../rbacSchemaConcern.ts";
import "../augment.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    hash: HashService;
  }
}

/**
 * Service provider that wires up the auth package. Registering it is all the setup
 * most apps need.
 *
 * On register it binds the `hash`, `gate`, and `two_factor` singletons and installs
 * the `app/policies` auto-discovery, auth-schema, and RBAC-schema concerns; on boot
 * it installs {@link PersistUserMiddleware} + {@link RememberMeMiddleware} (so
 * `ctx.user` is populated on every request), teaches `HttpContext.authorize()`, and
 * registers the `make:policy` and `auth:sync-permissions` CLI commands.
 *
 * @remarks
 * The user loader resolves in the order `app.withUserResolver(...)` →
 * {@link resolveUsing} → the convention default (the registered `AuthUser` model).
 * Guarding routes is a separate opt-in concern — see `AuthMiddleware`.
 *
 * @example
 * ```ts
 * // bootstrap/app.ts
 * import { AuthProvider } from "@zerotal/auth";
 *
 * export default Application.create({ providers: [AuthProvider, /* … *\/] });
 * ```
 */
export class AuthProvider extends ServiceProvider {
  static override provides = ["hash", "gate", "two_factor"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "test"];

  private static _resolver: ((id: number) => Promise<AuthUser | null>) | undefined;

  private _disposeObservability: (() => void) | undefined = undefined;

  /**
   * Register the user loader used by PersistUserMiddleware to populate ctx.user.
   *
   * Call this in `bootstrap/app.ts` before `Application.create()`:
   *
   * @example
   * import { AuthProvider } from '@zerotal/auth';
   * import { User } from '../app/models/User.ts';
   *
   * AuthProvider.resolveUsing((id) => User.find(id));
   *
   * export default Application.create({ providers })...
   */
  static resolveUsing(fn: (id: number) => Promise<AuthUser | null>): void {
    AuthProvider._resolver = fn;
  }

  override onRegister(): void {
    // Convention-based auto-discovery of app/policies. (Optional-chained so bare-container
    // unit tests with a minimal app stub don't need to stub registerConcern.)
    this.app.registerConcern?.(policiesConcern);
    // Provision auxiliary schema for the auth mixins (password_reset_tokens table,
    // email_verified_at column) once models are discovered — no token model required.
    this.app.registerConcern?.(authSchemaConcern);
    // Provision the relational-RBAC pivot tables when a model composes Roles/Permissions.
    this.app.registerConcern?.(rbacSchemaConcern);

    this.app.container.singleton("hash", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const algo = config.get<AuthConfigShape["algorithm"]>("auth.algorithm", "argon2id");
      return new HashService(algo);
    });

    this.app.container.singleton("gate", () => new GateService());

    this.app.container.singleton("two_factor", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const tfConfig = config.get<AuthConfigShape["twoFactor"]>("auth.twoFactor", {});
      return new TwoFactorService(tfConfig ?? {});
    });
  }

  override async onBooting(): Promise<void> {
    // Resolver precedence: app.withUserResolver(...) → AuthProvider.resolveUsing(...) → the
    // convention default, which loads the registered AuthUser-subclass model (the app's User).
    // No wiring required — registering AuthProvider is enough.
    const resolver =
      (this.app._userResolver as ((id: number) => Promise<AuthUser | null>) | undefined) ??
      AuthProvider._resolver ??
      defaultUserLoader;
    // Register as a ready value (not an async `bind`): the resolver is already
    // computed, and PersistUserMiddleware reads it synchronously (tryMake → makeSync),
    // which can't resolve a deferred async binding.
    this.app.container.value("auth.userLoader", resolver);
    // Populate ctx.user on every request (never blocks). Guarding a route is a
    // separate, opt-in concern — see AuthMiddleware.
    this.app.useOnce(PersistUserMiddleware as never);
    // Persistent "remember me": runs after PersistUserMiddleware, so it only
    // re-authenticates from the cookie when the session had no user. It also
    // flushes the remember cookie queued by Auth.login/logout.
    this.app.useOnce(RememberMeMiddleware as never);

    // Pre-resolve auth singletons so their facades (Gate, Hash, etc.) are
    // available via makeSync() in any provider's onBooted(). onBooting() runs
    // sequentially, so these are guaranteed to be resolved before onBooted()
    // fires on any provider (onBooted() runs concurrently via Promise.all).
    // Use make() (async) so the singleton binding is actually resolved and
    // marked resolved=true — tryMake/makeSync won't warm an unresolved singleton.
    // Swallow errors so a bare container (e.g. tests, omitted binding) doesn't crash.
    const warm = (k: string) => this.app.container.make(k as never).catch(() => {});
    await Promise.all([warm("hash"), warm("gate"), warm("two_factor")]);
  }

  override async onBooted(): Promise<void> {
    // Precompute the user-enumeration timing hash off the request path so the
    // first unknown-user login doesn't pay the one-time ~100 ms argon2id cost.
    // Fire-and-forget (never delays boot); skipped in tests to avoid the cost on
    // every test-app boot.
    if (this.app.environment !== "test") void warmLoginTiming();

    this._disposeObservability = installAuthObservability(this.app);

    (HttpContext.prototype as unknown as Record<string, unknown>).authorize = async function (
      this: HttpContext & { container?: { make(k: string): Promise<unknown> } },
      PolicyClass: never,
      ability: string,
      model: unknown,
    ): Promise<void> {
      const gate = (await this.container?.make("gate")) as GateService | undefined;
      const ok = gate ? gate._callPolicy(PolicyClass, ability, model as never) : false;
      if (!ok) throw new ForbiddenError();
    };

    const runner = this.app.container.tryMake("commands");
    if (!runner) return;

    runner.registerLazy("make:policy", () =>
      import("../commands/MakePolicyCommand.ts").then((m) => m.MakePolicyCommand),
    );
    runner.registerLazy("auth:sync-permissions", () =>
      import("../commands/SyncPermissionsCommand.ts").then((m) => m.SyncPermissionsCommand),
    );
  }

  override async onStopping(): Promise<void> {
    this._disposeObservability?.();
    this._disposeObservability = undefined;
  }
}
