import { ZerotalError } from "@zerotal/core";

/** Base class for every `@zerotal/settings` error. */
export class SettingsError extends ZerotalError {
  constructor(
    message: string,
    code = "E_SETTINGS",
    status = 500,
    context?: Record<string, unknown>,
  ) {
    super(message, code, status, context);
  }
}

/** A key no `defineSettings()` call declared. */
export class UnknownSettingError extends SettingsError {
  constructor(key: string) {
    super(
      `There is no setting "${key}". Declare it with defineSettings() before reading or writing it.`,
      "E_SETTING_UNKNOWN",
      500,
      { key },
    );
  }
}

/** Two `defineSettings()` calls declared the same key. */
export class DuplicateSettingError extends SettingsError {
  constructor(key: string) {
    super(
      `The setting "${key}" is declared twice. Each key belongs to one defineSettings() call.`,
      "E_SETTING_DUPLICATE",
      500,
      { key },
    );
  }
}

/** A value that is not what the setting's definition accepts. */
export class InvalidSettingValueError extends SettingsError {
  constructor(key: string, reason: string) {
    super(`Invalid value for the setting "${key}": ${reason}.`, "E_SETTING_INVALID", 422, {
      key,
      reason,
    });
  }
}

/**
 * A write at a level the setting does not allow, or at a level nothing identifies:
 * a tenant override outside any tenant, a user override with no user.
 */
export class SettingScopeError extends SettingsError {
  constructor(key: string, reason: string) {
    super(`Cannot use the setting "${key}" this way: ${reason}.`, "E_SETTING_SCOPE", 422, {
      key,
      reason,
    });
  }
}
