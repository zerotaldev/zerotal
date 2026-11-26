import { DuplicateSettingError, UnknownSettingError } from "./errors.ts";
import type { SettingDefinition } from "./setting.ts";

const _definitions = new Map<string, SettingDefinition>();

/**
 * Record a setting's definition. A key declared twice with two different
 * definitions is a mistake — two modules would read different defaults for it —
 * so it throws rather than letting the later one win.
 *
 * @internal
 */
export function _registerSetting(key: string, definition: SettingDefinition): void {
  const existing = _definitions.get(key);
  if (existing && existing !== definition) throw new DuplicateSettingError(key);
  _definitions.set(key, definition);
}

/**
 * The definition of a declared setting.
 *
 * @internal
 */
export function _definitionOf(key: string): SettingDefinition {
  const definition = _definitions.get(key);
  if (!definition) throw new UnknownSettingError(key);
  return definition;
}

/**
 * Every declared setting, in declaration order.
 *
 * @internal
 */
export function _allDefinitions(): [string, SettingDefinition][] {
  return [..._definitions.entries()];
}
