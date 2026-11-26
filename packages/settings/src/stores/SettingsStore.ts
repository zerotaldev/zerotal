import type { ScopeRef } from "../scope.ts";

/** One stored override, as a store hands it back. */
export interface StoredSetting {
  key: string;
  /** The level's id: `global`, `tenant:7`, `tenant:7:user:42`, `user:42`. */
  scope: string;
  tenantId: number | null;
  userId: string | null;
  /** The value, JSON-encoded. */
  value: string;
  /** Hidden overrides are kept, and skipped when reading. */
  hidden: boolean;
  /** Who last changed it, when a user did. */
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * Where overrides live.
 *
 * There is deliberately no way to delete one. Hiding an override stops it
 * applying and keeps its value, so it can be restored and its history still reads
 * against a row that exists.
 */
export interface SettingsStore {
  /** Every override of these keys at these levels, hidden ones included. */
  find(keys: readonly string[], scopes: readonly string[]): Promise<StoredSetting[]>;
  /** Write a value at a level, making it visible. Resolves to the row as it was before. */
  put(
    key: string,
    scope: ScopeRef,
    value: string,
    updatedBy: string | null,
  ): Promise<StoredSetting | null>;
  /** Hide or unhide an override. Resolves to the row as it was before, or `null` when there is none. */
  setHidden(
    key: string,
    scope: string,
    hidden: boolean,
    updatedBy: string | null,
  ): Promise<StoredSetting | null>;
}
