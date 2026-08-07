import { RequestContext } from "@zerotal/core";
import { DB, modelsByName, type BaseModel } from "@zerotal/orm";
import { TenantContext } from "./TenantContext.ts";
import { TenantModel } from "./TenantModel.ts";
import { NoActiveTenantError, TenantForbiddenError, TenancyConfigError } from "./errors.ts";
import type { Tenant } from "./types.ts";

/** The `tenant_members` pivot — central table linking users to tenants. */
/**
 * Pivot table holding tenant membership.
 * @internal exported so {@link TenancyMiddleware} can check membership without going
 * through the container-resolved facade — the check must hold on every request, including
 * ones served before or outside a fully-booted container.
 */
export const MEMBERS_TABLE = "tenant_members";

/** Same brand `@zerotal/auth` stamps on the User model — referenced via `Symbol.for`
 *  so tenancy can find the user model without depending on the auth package. */
const AUTHENTICATABLE = Symbol.for("zerotal.auth.authenticatable");

type UserCtor = typeof BaseModel & {
  find(id: number): Promise<BaseModel | null>;
  query(): { whereIn(c: string, v: unknown[]): { get(): Promise<BaseModel[]> } };
};

/** Hook fired after a tenant is deleted, for app-level cleanup of tenant-owned data. */
export type TenantDeletedHook = (tenant: Tenant) => void | Promise<void>;

/**
 * Tenancy service — the engine behind the `Tenant` facade. Implements the current-
 * tenant lifecycle, tenant CRUD against the internal `TenantModel`, and membership
 * (the `tenant_members` pivot) with admin-gated mutations.
 *
 * Resolved from the container as `"tenancy"`; use it via the `Tenant` facade.
 */
export class Tenancy {
  private readonly _onDeleted: TenantDeletedHook[] = [];

  // ── Current tenant ──────────────────────────────────────────────────────────

  /** The active tenant, or null outside a tenant boundary. */
  current(): Tenant | null {
    return TenantContext.tryGet() ?? null;
  }

  /** True when there is an active, enabled tenant. */
  check(): boolean {
    const t = this.current();
    return !!t && t.isActive;
  }

  /** The active tenant's id, or null. */
  id(): number | null {
    return this.current()?.id ?? null;
  }

  /** The active tenant's slug, or null. */
  slug(): string | null {
    return this.current()?.slug ?? null;
  }

  /** @internal The active tenant, or throw if outside a tenant boundary. */
  private requireCurrent(): Tenant {
    const t = TenantContext.tryGet();
    if (!t) throw new NoActiveTenantError();
    return t;
  }

  // ── Running work inside a tenant ─────────────────────────────────────────────

  /** Run `cb` with `tenant` as the active tenant (jobs, CLI, cross-tenant loops). */
  run<T>(tenant: Tenant, cb: () => T): T {
    return TenantContext.run(tenant, cb);
  }

  /** Load the tenant with `id` and run `cb` inside its context. */
  async forId<T>(id: number, cb: () => T | Promise<T>): Promise<T> {
    const tenant = await TenantModel.findOrFail(id);
    return TenantContext.run(tenant as unknown as Tenant, () => cb());
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  find(slug: string): Promise<TenantModel | null> {
    return TenantModel.query().where("slug", slug).first();
  }

  findById(id: number): Promise<TenantModel | null> {
    return TenantModel.find(id);
  }

  all(): Promise<TenantModel[]> {
    return TenantModel.query().get();
  }

  async exists(slug: string): Promise<boolean> {
    return (await this.find(slug)) !== null;
  }

  // ── Tenant lifecycle ─────────────────────────────────────────────────────────

  /**
   * Create a new tenant. If a user is authenticated on the current request, they
   * become the tenant's first **admin** member.
   */
  async create(data: Partial<Tenant> & { slug: string; name: string }): Promise<TenantModel> {
    const tenant = await TenantModel.create({ isActive: true, ...data } as never);
    const uid = this.currentUserId();
    if (uid != null) {
      await DB.table(MEMBERS_TABLE).insert({ tenant_id: tenant.id, user_id: uid, is_admin: 1 });
    }
    return tenant;
  }

  /** Update the current tenant. Throws unless the current user is an admin member. */
  async update(data: Partial<Tenant>): Promise<TenantModel> {
    if (!(await this.isMemberAdmin())) throw new TenantForbiddenError();
    return this.forceUpdate(data);
  }

  /** Update the current tenant, bypassing the admin check. Use from trusted code only. */
  async forceUpdate(data: Partial<Tenant>): Promise<TenantModel> {
    const model = await TenantModel.findOrFail(this.requireCurrent().id);
    await model.fill(data as never).save();
    return model;
  }

  /** Delete the current tenant and its memberships. Throws unless current user is admin. */
  async delete(): Promise<void> {
    if (!(await this.isMemberAdmin())) throw new TenantForbiddenError();
    return this.forceDelete();
  }

  /** Delete the current tenant and its memberships, bypassing the admin check. */
  async forceDelete(): Promise<void> {
    const tenant = this.requireCurrent();
    await DB.table(MEMBERS_TABLE).where("tenant_id", tenant.id).delete();
    const model = await TenantModel.find(tenant.id);
    if (model) await model.delete();
    for (const hook of this._onDeleted) await hook(tenant);
  }

  /** Register a cleanup hook fired after a tenant is deleted (drop tenant-owned data). */
  onTenantDeleted(hook: TenantDeletedHook): void {
    this._onDeleted.push(hook);
  }

  // ── Membership ──────────────────────────────────────────────────────────────

  /** The authenticated user as a member of the current tenant, or null if not a member. */
  async member<T = BaseModel>(): Promise<T | null> {
    const uid = this.currentUserId();
    if (uid == null || !(await this.isMember(uid))) return null;
    return (await this.userModel().find(uid)) as T | null;
  }

  /** Every member of the current tenant, hydrated as User models. */
  async members<T = BaseModel>(): Promise<T[]> {
    const tid = this.requireCurrent().id;
    const rows = await DB.table(MEMBERS_TABLE).where("tenant_id", tid).get<{ user_id: number }>();
    const ids = rows.map((r) => r.user_id);
    if (ids.length === 0) return [];
    return (await this.userModel().query().whereIn("id", ids).get()) as T[];
  }

  /** Number of members in the current tenant. */
  async memberCount(): Promise<number> {
    return DB.table(MEMBERS_TABLE).where("tenant_id", this.requireCurrent().id).count();
  }

  /** True when the user (default: current authenticated user) belongs to the current tenant. */
  async isMember(userId: number | null = this.currentUserId()): Promise<boolean> {
    const tid = this.id();
    if (userId == null || tid == null) return false;
    const row = await DB.table(MEMBERS_TABLE)
      .where("tenant_id", tid)
      .where("user_id", userId)
      .first();
    return !!row;
  }

  /** True when the user (default: current authenticated user) is an admin of the current tenant. */
  async isMemberAdmin(userId: number | null = this.currentUserId()): Promise<boolean> {
    const tid = this.id();
    if (userId == null || tid == null) return false;
    const row = await DB.table(MEMBERS_TABLE)
      .where("tenant_id", tid)
      .where("user_id", userId)
      .first<{ is_admin: number | boolean }>();
    return !!row && !!row.is_admin;
  }

  /** Add `userId` to the current tenant (idempotent). Pass `{ admin: true }` for an admin. */
  async addMember(userId: number, opts: { admin?: boolean } = {}): Promise<void> {
    const tid = this.requireCurrent().id;
    const flag = opts.admin ? 1 : 0;
    const existing = await DB.table(MEMBERS_TABLE)
      .where("tenant_id", tid)
      .where("user_id", userId)
      .first();
    if (existing) {
      if (opts.admin !== undefined) {
        await DB.table(MEMBERS_TABLE)
          .where("tenant_id", tid)
          .where("user_id", userId)
          .update({ is_admin: flag });
      }
      return;
    }
    await DB.table(MEMBERS_TABLE).insert({ tenant_id: tid, user_id: userId, is_admin: flag });
  }

  /** Remove `userId` from the current tenant. */
  async removeMember(userId: number): Promise<void> {
    await DB.table(MEMBERS_TABLE)
      .where("tenant_id", this.requireCurrent().id)
      .where("user_id", userId)
      .delete();
  }

  /** Grant the member admin rights in the current tenant. */
  promote(userId: number): Promise<void> {
    return this.addMember(userId, { admin: true });
  }

  /** Revoke the member's admin rights in the current tenant. */
  demote(userId: number): Promise<void> {
    return this.addMember(userId, { admin: false });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** The authenticated user's id on the active request, read structurally (no auth dep). */
  private currentUserId(): number | null {
    const user = (RequestContext.tryGet() as { user?: { id?: number } } | undefined)?.user;
    return user?.id ?? null;
  }

  /** Resolve the app's authenticatable (User) model from the ORM registry. */
  private userModel(): UserCtor {
    let first: UserCtor | undefined;
    for (const model of modelsByName.values()) {
      if ((model as unknown as Record<symbol, unknown>)[AUTHENTICATABLE]) {
        if ((model as { name?: string }).name === "User") return model as unknown as UserCtor;
        first ??= model as unknown as UserCtor;
      }
    }
    if (!first) {
      throw new TenancyConfigError(
        "Tenant membership requires an authenticatable User model. Compose `Authenticatable` " +
          "(from @zerotal/auth) on your User model.",
      );
    }
    return first;
  }
}
