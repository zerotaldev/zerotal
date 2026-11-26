import { DB } from "@zerotal/orm";
import type { ScopeRef } from "../scope.ts";
import type { SettingsStore, StoredSetting } from "./SettingsStore.ts";

/** A row as the database returns it. Booleans and ids vary by engine. */
interface Row {
  setting_key: string;
  scope_key: string;
  tenant_id: number | string | null;
  user_id: string | null;
  value: string;
  hidden: boolean | number | string | null;
  updated_by: string | null;
  updated_at: string | null;
}

function toStored(row: Row): StoredSetting {
  return {
    key: row.setting_key,
    scope: row.scope_key,
    tenantId: row.tenant_id === null ? null : Number(row.tenant_id),
    userId: row.user_id,
    value: row.value,
    // SQLite and MySQL hand back 0/1, PostgreSQL a boolean.
    hidden: row.hidden === true || Number(row.hidden) === 1,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at === null ? null : String(row.updated_at),
  };
}

/**
 * Overrides in the app's database, through the ORM's query builder — so it runs
 * wherever the app's connection does: SQLite, PostgreSQL or MySQL.
 *
 * One row per setting and level, unique on `(setting_key, scope_key)`. The table
 * is created on boot by the provider; see {@link settingsSchemaConcern}.
 */
export class DatabaseStore implements SettingsStore {
  constructor(private readonly table: string = "zerotal_settings") {}

  async find(keys: readonly string[], scopes: readonly string[]): Promise<StoredSetting[]> {
    if (keys.length === 0 || scopes.length === 0) return [];
    const rows = await DB.table(this.table)
      .whereIn("setting_key", [...keys])
      .whereIn("scope_key", [...scopes])
      .get<Row>();
    return rows.map(toStored);
  }

  private async _one(key: string, scope: string): Promise<StoredSetting | null> {
    const row = await DB.table(this.table)
      .where("setting_key", key)
      .where("scope_key", scope)
      .first<Row>();
    return row ? toStored(row) : null;
  }

  async put(
    key: string,
    scope: ScopeRef,
    value: string,
    updatedBy: string | null,
  ): Promise<StoredSetting | null> {
    const now = new Date().toISOString();
    const changes = { value, hidden: false, updated_by: updatedBy, updated_at: now };
    const before = await this._one(key, scope.id);
    if (before) {
      await this._update(key, scope.id, changes);
      return before;
    }
    try {
      await DB.table(this.table).insert({
        setting_key: key,
        scope_key: scope.id,
        tenant_id: scope.tenant,
        user_id: scope.user,
        created_at: now,
        ...changes,
      });
      return null;
    } catch (error) {
      // Another process inserted the same level between the read and the insert:
      // the unique index refused the second row. Write over the one that won.
      const raced = await this._one(key, scope.id);
      if (!raced) throw error;
      await this._update(key, scope.id, changes);
      return raced;
    }
  }

  async setHidden(
    key: string,
    scope: string,
    hidden: boolean,
    updatedBy: string | null,
  ): Promise<StoredSetting | null> {
    const before = await this._one(key, scope);
    if (!before) return null;
    await this._update(key, scope, {
      hidden,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    });
    return before;
  }

  private async _update(key: string, scope: string, data: Record<string, unknown>): Promise<void> {
    await DB.table(this.table).where("setting_key", key).where("scope_key", scope).update(data);
  }
}
