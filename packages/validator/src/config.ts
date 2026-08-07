import { deepMerge } from "@zerotal/core";

export interface ValidatorConfigShape {
  /** Stop validation after the first failure per field. Default: true */
  stopOnFirstFailure: boolean;
  /** Default locale for error messages. Default: 'en' */
  locale: string;
}

const defaults: ValidatorConfigShape = {
  stopOnFirstFailure: true,
  locale: "en",
};

/**
 * Create a typed validator configuration object with defaults.
 *
 * @example
 * import { ValidatorConfig } from '@zerotal/validator';
 * export default ValidatorConfig({ locale: 'af' });
 */
export function ValidatorConfig(options: Partial<ValidatorConfigShape> = {}): ValidatorConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    validator: ValidatorConfigShape;
  }
}
