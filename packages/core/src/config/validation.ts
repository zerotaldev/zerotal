/**
 * Boot-time config validation with production-refusal semantics.
 *
 * Each config namespace already has a typed shape in {@link ConfigRegistry}; a
 * package can attach a validator to its namespace (via
 * `app.registerConfigValidator(namespace, fn)`) that inspects the loaded value
 * and reports problems. The boot sequence runs every validator once, after
 * providers register and before they boot:
 *
 * - in a **production-like** deployment, any `error`-level issue **refuses boot**
 *   — aggregated into a {@link ConfigValidationError} that names each culprit;
 * - everywhere else, issues are logged as warnings and boot continues.
 *
 * `warning`-level issues are always advisory (logged, never fatal). This is the
 * "delight in development, refusal in production" posture: a placeholder secret
 * or an insecure cookie flag is a nuisance locally and a hard stop in prod.
 */
import type { ConfigManager } from "./ConfigManager.ts";
import { ZerotalError } from "../errors/ZerotalError.ts";

/** Severity of a config problem. `error` refuses boot in production; `warning` only ever warns. */
export type ConfigIssueLevel = "error" | "warning";

/** A single problem a config validator reports. */
export interface ConfigIssue {
  /** `error` — fatal in production. `warning` — always advisory. */
  level: ConfigIssueLevel;
  /** Human-readable description plus the remedy. */
  message: string;
}

/** Context handed to a config validator. */
export interface ConfigValidationContext {
  /** The namespace being validated (e.g. `"session"`). */
  namespace: string;
  /** True in a production-like deployment — the only case where `error` issues are fatal. */
  isProduction: boolean;
  /** The full config store, for cross-namespace reads (e.g. checking `app.key`). */
  config: ConfigManager;
}

/**
 * Validates one config namespace's loaded value and returns any problems found.
 *
 * The value arrives as `unknown` — config is a dynamic dot-path store, so a
 * validator narrows to its namespace's shape itself (usually with a single cast
 * to the package's `*ConfigShape`). Return an empty array (or nothing) when the
 * namespace is well-formed.
 */
export type ConfigValidator = (
  value: unknown,
  ctx: ConfigValidationContext,
) => ConfigIssue[] | void;

/** A validator paired with the namespace it guards, as held on the application. */
export interface RegisteredConfigValidator {
  namespace: string;
  validate: ConfigValidator;
}

/**
 * Thrown when config validation refuses a production boot. Lists every fatal
 * issue by namespace, so a startup failure names exactly what to fix.
 *
 * @category Errors
 */
export class ConfigValidationError extends ZerotalError {
  constructor(public readonly issues: Array<{ namespace: string; message: string }>) {
    super(ConfigValidationError._format(issues), "E_CONFIG_VALIDATION_FAILED", 500, { issues });
  }

  private static _format(issues: Array<{ namespace: string; message: string }>): string {
    const lines = issues.map((i) => `  • config(${i.namespace}): ${i.message}`);
    const plural = issues.length === 1 ? "" : "s";
    return (
      `[Zerotal] Refusing to boot: ${issues.length} insecure or invalid config value${plural} ` +
      `in this production deployment:\n${lines.join("\n")}`
    );
  }
}

/**
 * Run every registered validator against the loaded config.
 *
 * In a production-like deployment, each `error`-level issue is collected and, if
 * any exist, an aggregated {@link ConfigValidationError} is thrown (boot
 * refused). Otherwise — and for every `warning`-level issue in any environment —
 * the issue is logged via `warn` and boot continues.
 *
 * @param validators - The namespace/validator pairs to run.
 * @param config - The loaded configuration store.
 * @param isProduction - Whether this is a production-like deployment.
 * @param warn - Sink for advisory messages (defaults to `console.warn`).
 * @throws {ConfigValidationError} in production when one or more `error` issues are found.
 */
export function runConfigValidators(
  validators: readonly RegisteredConfigValidator[],
  config: ConfigManager,
  isProduction: boolean,
  warn: (message: string) => void = console.warn,
): void {
  const fatal: Array<{ namespace: string; message: string }> = [];

  for (const { namespace, validate } of validators) {
    const value = config.get(namespace);
    const issues = validate(value, { namespace, isProduction, config }) ?? [];
    for (const issue of issues) {
      if (issue.level === "error" && isProduction) {
        fatal.push({ namespace, message: issue.message });
      } else {
        warn(`[Zerotal] config(${namespace}): ${issue.message}`);
      }
    }
  }

  if (fatal.length > 0) throw new ConfigValidationError(fatal);
}
