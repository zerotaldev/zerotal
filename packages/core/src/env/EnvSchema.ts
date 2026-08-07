/**
 * `EnvSchema` — defines and validates a strict, fully-typed environment schema
 * at import time, collecting every failure into a single readable error.
 */
import { Def, EnvFieldError } from "./Def.ts";
import type { EnvOutput } from "./Def.ts";
import { ZerotalError } from "../errors/ZerotalError.ts";

// ── Schema-level error ────────────────────────────────────────────────────────

/**
 * Thrown by `EnvSchema.define()` when one or more environment variables
 * fail validation. Contains all failures, not just the first.
 */
export class EnvSchemaError extends ZerotalError {
  readonly errors: EnvFieldError[];

  constructor(errors: EnvFieldError[]) {
    super(EnvSchemaError._format(errors), "E_ENV_SCHEMA", 500);
    this.errors = errors;
  }

  private static _format(errors: EnvFieldError[]): string {
    const lines = [
      "",
      "\x1b[31m[Zerotal Env]\x1b[0m Environment validation failed — the application cannot start.",
      "",
      ...errors.map((error) => error.format()),
      "",
      "Check your \x1b[33m.env\x1b[0m file and try again.",
      "",
    ];
    return lines.join("\n");
  }
}

// ── EnvSchema ─────────────────────────────────────────────────────────────────

/**
 * Define and validate a strict environment schema at import time.
 *
 * The schema is parsed once when the module is first imported. If any variable
 * fails validation, the application refuses to start and prints every failure
 * in a single readable error — not just the first one.
 *
 * All fields of the returned object are **read-only** and **fully typed**.
 *
 * @example
 * ```ts
 * // app/config/env.ts
 * import { EnvSchema, t } from '@zerotal/core/env';
 *
 * export const env = EnvSchema.define({
 *   PORT:          t.number().default(3000),
 *   NODE_ENV:      t.enum(['development', 'production', 'testing']).required(),
 *   DB_HOST:       t.string().required(),
 *   DB_PASS:       t.string().when('NODE_ENV', 'production', t.required()),
 *   STRIPE_SECRET: t.string().when('NODE_ENV', 'production', t.required()),
 *   DEBUG:         t.boolean().default(false),
 *   BASE_URL:      t.url().default('http://localhost:3000'),
 * });
 *
 * // Anywhere else:
 * import { env } from './config/env.ts';
 * console.log(env.PORT);     // number — never undefined
 * console.log(env.DB_HOST);  // string — validated at boot
 * ```
 */
export const EnvSchema = {
  /**
   * Parse and validate all env variables against the schema.
   *
   * @param schema  A plain object whose values are `Def<T>` instances from `t.*`.
   * @param source  Optional env source (defaults to `Bun.env`). Pass a plain
   *                object in tests to avoid polluting the real environment.
   *
   * @throws EnvSchemaError when any variable fails validation.
   */
  define<S extends Record<string, Def<unknown>>>(
    schema: S,
    source: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
  ): EnvOutput<S> {
    const errors: EnvFieldError[] = [];
    const result: Record<string, unknown> = {};

    for (const [key, def] of Object.entries(schema)) {
      const raw = source[key];
      try {
        result[key] = def._parse(key, raw, source);
      } catch (error) {
        if (error instanceof EnvFieldError) {
          errors.push(error);
        } else {
          throw error;
        }
      }
    }

    if (errors.length > 0) {
      throw new EnvSchemaError(errors);
    }

    return Object.freeze(result) as EnvOutput<S>;
  },
} as const;
