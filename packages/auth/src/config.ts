import { deepMerge } from "@zerotal/core";
import type { TwoFactorOptions } from "./TwoFactorService.ts";

/**
 * Shape of `config/auth.ts` — package-level auth options. Build one with
 * {@link AuthConfig}, which applies defaults (`algorithm: 'argon2id'`).
 */
export interface AuthConfigShape {
  /** Password hashing algorithm. Default: 'argon2id' */
  algorithm: "argon2id" | "bcrypt";

  /** Two-factor authentication configuration. */
  twoFactor?: TwoFactorOptions;
}

const defaults: AuthConfigShape = {
  algorithm: "argon2id",
};

/**
 * Create a typed auth configuration object with defaults.
 *
 * @example
 * import { AuthConfig } from '@zerotal/auth';
 *
 * export default AuthConfig({
 *   algorithm: 'argon2id',
 *   twoFactor: { issuer: 'My App' },
 * });
 */
export function AuthConfig(options: Partial<AuthConfigShape> = {}): AuthConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    auth: AuthConfigShape;
  }
}
