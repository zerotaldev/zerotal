import type { ScopeRef } from "../scope.ts";
import type { SettingsStore, StoredSetting } from "./SettingsStore.ts";

/**
 * Overrides in process memory, with the same rules as the database: one entry
 * per setting and level, hidden rather than deleted. What `SettingsFake` runs on,
 * so a test of tenant or user overrides needs no table.
 */
export class MemoryStore implements SettingsStore {
  private readonly _rows = new Map<string, StoredSetting>();

  private static _id(key: string, scope: string): string {
    return `${key}\u0000${scope}`;
  }

  async find(keys: readonly string[], scopes: readonly string[]): Promise<StoredSetting[]> {
    const out: StoredSetting[] = [];
    for (const row of this._rows.values()) {
      if (keys.includes(row.key) && scopes.includes(row.scope)) out.push({ ...row });
    }
    return out;
  }

  async put(
    key: string,
    scope: ScopeRef,
    value: string,
    updatedBy: string | null,
  ): Promise<StoredSetting | null> {
    const id = MemoryStore._id(key, scope.id);
    const before = this._rows.get(id);
    this._rows.set(id, {
      key,
      scope: scope.id,
      tenantId: scope.tenant,
      userId: scope.user,
      value,
      hidden: false,
      updatedBy,
      updatedAt: new Date().toISOString(),
    });
    return before ? { ...before } : null;
  }

  async setHidden(
    key: string,
    scope: string,
    hidden: boolean,
    updatedBy: string | null,
  ): Promise<StoredSetting | null> {
    const row = this._rows.get(MemoryStore._id(key, scope));
    if (!row) return null;
    const before = { ...row };
    Object.assign(row, { hidden, updatedBy, updatedAt: new Date().toISOString() });
    return before;
  }

  /** Every stored override, hidden ones included. For assertions. */
  all(): StoredSetting[] {
    return [...this._rows.values()].map((row) => ({ ...row }));
  }
}
