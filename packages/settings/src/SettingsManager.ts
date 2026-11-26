import { RequestContext } from "@zerotal/core";
import { frameworkLog } from "@zerotal/core/logger";
import { TenantContext } from "@zerotal/tenancy";
import { _optionalService } from "./container.ts";
import { SettingScopeError } from "./errors.ts";
import { _allDefinitions, _definitionOf } from "./registry.ts";
import { _scopeRef } from "./scope.ts";
import type { ScopeRef, SettingsScope } from "./scope.ts";
import type { SettingDefinition, SettingScopeKind } from "./setting.ts";
import type { SettingsStore, StoredSetting } from "./stores/SettingsStore.ts";

/** Where a setting's value came from. `override` is a test pin; see `SettingsFake`. */
export type SettingSource = SettingScopeKind | "default" | "override";

/** One stored level of a setting, as {@link ResolvedSetting.levels} lists it. */
export interface SettingLevel {
  kind: SettingScopeKind;
  /** The stored value, or `undefined` when it no longer fits the definition. */
  value: unknown;
  hidden: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** A setting's value and the reasoning behind it. */
export interface ResolvedSetting<T = unknown> {
  key: string;
  value: T;
  /** The level the value came from. */
  source: SettingSource;
  /** The value in code. */
  default: T;
  /** Every stored level that applies to this reader, most specific first, hidden ones included. */
  levels: SettingLevel[];
}

/** Options for a write: the level to write at, and whose it is. */
export interface SettingWriteOptions extends SettingsScope {
  /**
   * The level to write at. Default: `"tenant"` inside a tenant, otherwise
   * `"global"` (or `"tenant"`, and an error, for a setting with no app-wide level).
   * Never `"global"` inside a tenant, so a tenant's write cannot become app-wide
   * by accident. A user override is always asked for by name.
   */
  at?: SettingScopeKind | undefined;
}

/** One change to a setting, from the audit trail. */
export interface SettingHistoryEntry {
  /** `setting.updated`, `setting.hidden` or `setting.unhidden`. */
  event: string;
  from: unknown;
  to: unknown;
  /** The acting user's id, when a user made the change. */
  actor: number | null;
  at: string;
}

/** Options for {@link SettingsManager.history}. */
export interface SettingHistoryOptions extends SettingWriteOptions {
  /** How many entries, newest first. Default: 25. */
  limit?: number | undefined;
}

/** The slice of `@zerotal/audit`'s service this package uses, resolved from the container. */
interface AuditSink {
  log(
    event: string,
    payload: {
      auditable_type: string;
      auditable_id: string;
      old_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null;
      tags: Record<string, unknown>;
    },
  ): Promise<void>;
  logs(
    type: string,
    id: string,
  ): {
    orderBy(column: string, direction: string): { limit(n: number): { get(): Promise<object[]> } };
  };
}

/** The type the audit trail files setting changes under. */
const AUDIT_TYPE = "Setting";

/** The authenticated user's id, read structurally: this package does not depend on auth. */
function contextUserId(): string | null {
  const user = (RequestContext.tryGet() as { user?: { id?: unknown } } | undefined)?.user;
  const id = user?.id;
  return id === undefined || id === null ? null : String(id);
}

function decode(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

/**
 * Settings: typed defaults in code, overridden per tenant, per user or app-wide.
 *
 * Bound as `settings` by {@link SettingsProvider}. Reach it through a group from
 * `defineSettings()`, whose reads are typed, or the `Settings` facade.
 *
 * A read takes the most specific value that applies: the user's override, then
 * the tenant's, then the app-wide one, then the default in code. The tenant and
 * the user come from the context — `TenantContext` and the authenticated request
 * — unless the call names them.
 */
export class SettingsManager {
  constructor(
    protected readonly store: SettingsStore,
    protected readonly options: { audit: boolean } = { audit: true },
  ) {}

  // ── Reading ─────────────────────────────────────────────────────────────

  /** A setting's value for the current tenant and user, or the ones `scope` names. */
  async get(key: string, scope?: SettingsScope): Promise<unknown> {
    return (await this.resolve(key, scope)).value;
  }

  /** A setting's value, where it came from, and every level that applies. */
  async resolve(key: string, scope?: SettingsScope): Promise<ResolvedSetting> {
    const [resolved] = await this.resolveMany([key], scope);
    return resolved!;
  }

  /** Several settings at once, in one read of the store. */
  async resolveMany(keys: readonly string[], scope?: SettingsScope): Promise<ResolvedSetting[]> {
    const who = this._who(scope);
    const plans = keys.map((key) => {
      const definition = _definitionOf(key);
      return { key, definition, refs: this._readLevels(definition, who) };
    });
    const scopeIds = [...new Set(plans.flatMap((p) => p.refs.map((r) => r.id)))];
    const rows = await this.store.find(keys, scopeIds);
    const byId = new Map(rows.map((row) => [`${row.key}\u0000${row.scope}`, row]));

    return plans.map(({ key, definition, refs }) => {
      const levels: SettingLevel[] = [];
      let found: { value: unknown; source: SettingSource } | undefined;
      for (const ref of refs) {
        const row = byId.get(`${key}\u0000${ref.id}`);
        if (!row) continue;
        const value = this._read(key, definition, row);
        levels.push({
          kind: ref.kind,
          value,
          hidden: row.hidden,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt,
        });
        if (!found && !row.hidden && value !== undefined) found = { value, source: ref.kind };
      }
      return {
        key,
        value: found ? found.value : definition.default,
        source: found ? found.source : "default",
        default: definition.default,
        levels,
      };
    });
  }

  /** Every declared setting, resolved for the current tenant and user. */
  async all(scope?: SettingsScope): Promise<ResolvedSetting[]> {
    return this.resolveMany(
      _allDefinitions().map(([key]) => key),
      scope,
    );
  }

  /** Every declared setting's key and definition. */
  definitions(): [string, SettingDefinition][] {
    return _allDefinitions();
  }

  // ── Writing ─────────────────────────────────────────────────────────────

  /**
   * Override a setting at one level. The value is checked against the definition
   * first, and a hidden override at that level is made visible again with it.
   */
  async set(key: string, value: unknown, options: SettingWriteOptions = {}): Promise<void> {
    const definition = _definitionOf(key);
    const parsed = definition.parse(value, key);
    const ref = this._writeLevel(key, definition, options);
    const before = await this.store.put(key, ref, JSON.stringify(parsed), contextUserId());
    await this._audit(
      "setting.updated",
      key,
      ref,
      before ? this._readSafe(key, before) : undefined,
      parsed,
    );
  }

  /**
   * {@link set} from text typed into a form: `"42"` for a number setting, `"true"`
   * for a boolean, JSON for a JSON setting.
   */
  async setFromText(key: string, text: string, options: SettingWriteOptions = {}): Promise<void> {
    const definition = _definitionOf(key);
    await this.set(key, definition.parse(text, key, true), options);
  }

  /**
   * Stop an override applying, so the next level shows through — and keep it.
   *
   * Overrides are never deleted: the value stays stored, its history stays
   * attached to it, and {@link unhide} puts it back. Resolves to `false` when
   * there is no override at that level to hide.
   */
  async hide(key: string, options: SettingWriteOptions = {}): Promise<boolean> {
    return this._setHidden(key, true, options);
  }

  /** Make a hidden override apply again. `false` when there is none at that level. */
  async unhide(key: string, options: SettingWriteOptions = {}): Promise<boolean> {
    return this._setHidden(key, false, options);
  }

  private async _setHidden(
    key: string,
    hidden: boolean,
    options: SettingWriteOptions,
  ): Promise<boolean> {
    const definition = _definitionOf(key);
    const ref = this._writeLevel(key, definition, options);
    const before = await this.store.setHidden(key, ref.id, hidden, contextUserId());
    if (!before) return false;
    if (before.hidden !== hidden) {
      const value = this._readSafe(key, before);
      await this._audit(
        hidden ? "setting.hidden" : "setting.unhidden",
        key,
        ref,
        hidden ? value : undefined,
        hidden ? undefined : value,
      );
    }
    return true;
  }

  // ── History ─────────────────────────────────────────────────────────────

  /**
   * The changes to a setting at one level, newest first, from the audit trail.
   * Empty when `@zerotal/audit` is not registered. Each level has its own trail,
   * so a tenant's history never shows another tenant's changes.
   */
  async history(key: string, options: SettingHistoryOptions = {}): Promise<SettingHistoryEntry[]> {
    const definition = _definitionOf(key);
    const ref = this._writeLevel(key, definition, options);
    const audit = this._auditSink();
    if (!audit) return [];
    const rows = await audit
      .logs(AUDIT_TYPE, `${key}@${ref.id}`)
      .orderBy("id", "desc")
      .limit(options.limit ?? 25)
      .get();
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      const field = (camel: string, snake: string): unknown => r[camel] ?? r[snake];
      const values = (v: unknown): Record<string, unknown> | null => {
        if (typeof v === "string") return JSON.parse(v) as Record<string, unknown>;
        return (v as Record<string, unknown> | null) ?? null;
      };
      const at = field("createdAt", "created_at");
      const actor = field("actorId", "actor_id");
      return {
        event: String(r["event"]),
        from: values(field("oldValues", "old_values"))?.["value"],
        to: values(field("newValues", "new_values"))?.["value"],
        actor: actor === null || actor === undefined ? null : Number(actor),
        at: at instanceof Date ? at.toISOString() : String(at ?? ""),
      };
    });
  }

  // ── Levels ──────────────────────────────────────────────────────────────

  /** The tenant and user a call is for: what it names, else the context. */
  protected _who(scope?: SettingsScope): { tenant: number | null; user: string | null } {
    const tenant = scope?.tenant !== undefined ? scope.tenant : TenantContext.id();
    const user = scope?.user !== undefined ? scope.user : contextUserId();
    return { tenant, user: user === null ? null : String(user) };
  }

  /** The stored levels a read consults for this setting, most specific first. */
  private _readLevels(
    definition: SettingDefinition,
    who: { tenant: number | null; user: string | null },
  ): ScopeRef[] {
    const refs: ScopeRef[] = [];
    if (definition.scopes.includes("user") && who.user !== null) {
      refs.push(_scopeRef("user", who.tenant, who.user));
    }
    if (definition.scopes.includes("tenant") && who.tenant !== null) {
      refs.push(_scopeRef("tenant", who.tenant, null));
    }
    if (definition.scopes.includes("global")) refs.push(_scopeRef("global", null, null));
    return refs;
  }

  /** The one level a write goes to, or a {@link SettingScopeError} saying why it cannot. */
  private _writeLevel(
    key: string,
    definition: SettingDefinition,
    options: SettingWriteOptions,
  ): ScopeRef {
    const who = this._who(options);
    // Inside a tenant the default is always the tenant's own level: a write there
    // must never quietly become an app-wide one because the setting is global-only.
    const at =
      options.at ??
      (who.tenant !== null || !definition.scopes.includes("global") ? "tenant" : "global");
    if (!definition.scopes.includes(at)) {
      throw new SettingScopeError(
        key,
        `it cannot be overridden per ${at === "global" ? "app" : at}; ` +
          `its definition allows ${definition.scopes.join(", ") || "no overrides"}`,
      );
    }
    if (at === "tenant" && who.tenant === null) {
      throw new SettingScopeError(key, "there is no tenant here; name one with { tenant }");
    }
    if (at === "user" && who.user === null) {
      throw new SettingScopeError(key, "there is no signed-in user here; name one with { user }");
    }
    return _scopeRef(at, who.tenant, at === "user" ? who.user : null);
  }

  // ── Values ──────────────────────────────────────────────────────────────

  /**
   * A stored value, parsed by today's definition. One that no longer fits — the
   * definition tightened after it was saved — is skipped with a warning, so the
   * reader gets the next level rather than a value of the wrong type.
   */
  private _read(key: string, definition: SettingDefinition, row: StoredSetting): unknown {
    try {
      return definition.parse(decode(row.value), key);
    } catch (error) {
      frameworkLog("settings").warn(
        `Ignoring the stored value of "${key}" at ${row.scope}: it no longer fits its definition`,
        { key, scope: row.scope },
        error,
      );
      return undefined;
    }
  }

  private _readSafe(key: string, row: StoredSetting): unknown {
    try {
      return decode(row.value);
    } catch {
      return row.value;
    }
  }

  // ── Audit ───────────────────────────────────────────────────────────────

  /** The audit service, when `AuditProvider` is registered and auditing is on. */
  private _auditSink(): AuditSink | undefined {
    return this.options.audit ? _optionalService<AuditSink>("audit") : undefined;
  }

  private async _audit(
    event: string,
    key: string,
    ref: ScopeRef,
    from: unknown,
    to: unknown,
  ): Promise<void> {
    const audit = this._auditSink();
    if (!audit) return;
    await audit.log(event, {
      auditable_type: AUDIT_TYPE,
      // One trail per setting per level, so reading a tenant's history is a lookup
      // on its own id and can never return another tenant's entries.
      auditable_id: `${key}@${ref.id}`,
      old_values: from === undefined ? null : { value: from },
      new_values: to === undefined ? null : { value: to },
      tags: { key, level: ref.kind, tenant: ref.tenant, user: ref.user },
    });
  }
}
