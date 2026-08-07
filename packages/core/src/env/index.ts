/**
 * The `@zerotal/core/env` subpath — a strict, fully-typed environment schema.
 *
 * Declare every variable your app reads with the {@link t} field builder
 * (`t.string()`, `t.number()`, `t.enum([...])`, …) and hand the map to
 * {@link EnvSchema.define}. The schema is parsed and validated once at import
 * time: missing required vars, bad numbers, invalid URLs, and out-of-range
 * ports all fail the boot with a single {@link EnvSchemaError} that lists every
 * failure at once. The returned object is frozen and precisely typed, so
 * `env.PORT` is `number` (never `undefined`) and enum fields narrow to their
 * literals.
 *
 * @example
 * ```ts
 * import { EnvSchema, t } from "@zerotal/core/env";
 *
 * export const env = EnvSchema.define({
 *   PORT:     t.number().default(3000),
 *   NODE_ENV: t.enum(["development", "production", "testing"]).required(),
 *   DB_HOST:  t.string().required(),
 *   DB_PASS:  t.string().when("NODE_ENV", "production", t.required()),
 *   BASE_URL: t.url().default("http://localhost:3000"),
 * });
 *
 * console.log(env.PORT);    // number — never undefined
 * console.log(env.DB_HOST); // string — validated at boot
 * ```
 *
 * @packageDocumentation
 */
export { EnvSchema, EnvSchemaError } from "./EnvSchema.ts";
export { t } from "./t.ts";
export { Def, EnvFieldError } from "./Def.ts";
export type { EnvOutput, InferDef, FieldType } from "./Def.ts";
