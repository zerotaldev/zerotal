import { describe, it, expect } from "bun:test";
import { EnvSchema, EnvSchemaError, t } from "./index.ts";

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Shorthand: define a schema against a custom env object. The bound is whatever
 * `define()` itself accepts — pinning it to `t.string()` would leave every
 * `t.number()` / `t.boolean()` case below inferring the wrong `Def`.
 */
function parse<S extends Parameters<typeof EnvSchema.define>[0]>(
  schema: S,
  env: Record<string, string | undefined>,
) {
  return EnvSchema.define(schema, env);
}

function errors(
  schema: Parameters<typeof EnvSchema.define>[0],
  env: Record<string, string | undefined>,
): string[] {
  try {
    EnvSchema.define(schema, env);
    return [];
  } catch (e) {
    if (e instanceof EnvSchemaError) return e.errors.map((err) => `${err.key}: ${err.message}`);
    throw e;
  }
}

// ── t.string() ────────────────────────────────────────────────────────────────

describe("t.string()", () => {
  it("returns the raw string value", () => {
    const env = parse({ KEY: t.string() }, { KEY: "hello" });
    expect(env.KEY).toBe("hello");
  });

  it("returns undefined when absent and not required", () => {
    const env = parse({ KEY: t.string() }, {});
    expect(env.KEY).toBeUndefined();
  });

  it(".required() throws when missing", () => {
    expect(() => parse({ DB_HOST: t.string().required() }, {})).toThrow(EnvSchemaError);
  });

  it(".required() returns the value when present", () => {
    const env = parse({ DB_HOST: t.string().required() }, { DB_HOST: "localhost" });
    expect(env.DB_HOST).toBe("localhost");
  });

  it(".default() returns default when absent", () => {
    const env = parse({ APP_NAME: t.string().default("Zerotal") }, {});
    expect(env.APP_NAME).toBe("Zerotal");
  });

  it(".default() is overridden by a present value", () => {
    const env = parse({ APP_NAME: t.string().default("Zerotal") }, { APP_NAME: "MyApp" });
    expect(env.APP_NAME).toBe("MyApp");
  });

  it("empty string is treated as absent", () => {
    const env = parse({ KEY: t.string().default("fallback") }, { KEY: "" });
    expect(env.KEY).toBe("fallback");
  });
});

// ── t.number() ────────────────────────────────────────────────────────────────

describe("t.number()", () => {
  it("coerces numeric strings to numbers", () => {
    const env = parse({ PORT: t.number() }, { PORT: "3000" });
    expect(env.PORT).toBe(3000);
    expect(typeof env.PORT).toBe("number");
  });

  it("returns undefined when absent and not required", () => {
    expect(parse({ PORT: t.number() }, {}).PORT).toBeUndefined();
  });

  it(".default() provides a numeric fallback", () => {
    expect(parse({ PORT: t.number().default(8080) }, {}).PORT).toBe(8080);
  });

  it("fails when value is non-numeric", () => {
    expect(() => parse({ PORT: t.number().required() }, { PORT: "abc" })).toThrow(EnvSchemaError);
  });

  it("collects the error message referencing the key", () => {
    const errs = errors({ PORT: t.number().required() }, { PORT: "not-a-number" });
    expect(errs[0]).toContain("PORT");
    expect(errs[0]).toContain("number");
  });
});

// ── t.boolean() ───────────────────────────────────────────────────────────────

describe("t.boolean()", () => {
  it.each([
    ["true", true],
    ["1", true],
    ["yes", true],
    ["YES", true],
    ["True", true],
    ["false", false],
    ["0", false],
    ["no", false],
    ["NO", false],
    ["False", false],
  ] as [string, boolean][])('coerces "%s" → %s', (raw, expected) => {
    expect(parse({ FLAG: t.boolean() }, { FLAG: raw }).FLAG).toBe(expected);
  });

  it("fails on unrecognized boolean string", () => {
    const errs = errors({ FLAG: t.boolean().required() }, { FLAG: "maybe" });
    expect(errs[0]).toContain("boolean");
  });

  it(".default() provides a boolean fallback", () => {
    expect(parse({ DEBUG: t.boolean().default(false) }, {}).DEBUG).toBe(false);
  });
});

// ── t.enum() ─────────────────────────────────────────────────────────────────

describe("t.enum()", () => {
  const envDef = t.enum(["development", "production", "testing"] as const);

  it("returns the value when it is in the allowlist", () => {
    const env = parse({ NODE_ENV: envDef }, { NODE_ENV: "production" });
    expect(env.NODE_ENV).toBe("production");
  });

  it("returns undefined when absent and not required", () => {
    expect(parse({ NODE_ENV: envDef }, {}).NODE_ENV).toBeUndefined();
  });

  it(".required() fails when missing", () => {
    expect(() => parse({ NODE_ENV: envDef.required() }, {})).toThrow(EnvSchemaError);
  });

  it("fails when value is not in the allowlist", () => {
    const errs = errors({ NODE_ENV: envDef.required() }, { NODE_ENV: "staging" });
    expect(errs[0]).toContain("staging");
    expect(errs[0]).toContain("development");
  });

  it("infers literal union type (compile-time smoke test)", () => {
    // If TypeScript inference is wrong, this line produces a type error at build time.
    const env = parse({ NODE_ENV: envDef.required() }, { NODE_ENV: "development" });
    const _check: "development" | "production" | "testing" = env.NODE_ENV;
    expect(_check).toBe("development");
  });
});

// ── t.url() ───────────────────────────────────────────────────────────────────

describe("t.url()", () => {
  it("accepts a valid URL string", () => {
    const env = parse({ API: t.url().required() }, { API: "https://api.example.com/v1" });
    expect(env.API).toBe("https://api.example.com/v1");
  });

  it("fails on an invalid URL", () => {
    const errs = errors({ API: t.url().required() }, { API: "not-a-url" });
    expect(errs[0]).toContain("URL");
  });
});

// ── t.port() ─────────────────────────────────────────────────────────────────

describe("t.port()", () => {
  it("coerces valid port strings to numbers", () => {
    expect(parse({ PORT: t.port().default(3000) }, { PORT: "8080" }).PORT).toBe(8080);
  });

  it("fails on out-of-range port", () => {
    const errs = errors({ PORT: t.port().required() }, { PORT: "99999" });
    expect(errs[0]).toContain("65535");
  });

  it("fails on non-integer", () => {
    const errs = errors({ PORT: t.port().required() }, { PORT: "80.5" });
    expect(errs[0]).toContain("port");
  });
});

// ── .when() conditional ───────────────────────────────────────────────────────

describe(".when()", () => {
  it("requires the field when condition is met", () => {
    const schema = {
      NODE_ENV: t.enum(["development", "production"] as const).required(),
      STRIPE_SECRET: t.string().when("NODE_ENV", "production", t.required()),
    };

    // production — STRIPE_SECRET must be present
    expect(() => EnvSchema.define(schema, { NODE_ENV: "production" })).toThrow(EnvSchemaError);

    // production — STRIPE_SECRET present — passes
    const env = EnvSchema.define(schema, { NODE_ENV: "production", STRIPE_SECRET: "sk_live_abc" });
    expect(env.STRIPE_SECRET).toBe("sk_live_abc");
  });

  it("does NOT require the field when condition is NOT met", () => {
    const schema = {
      NODE_ENV: t.enum(["development", "production"] as const).required(),
      STRIPE_SECRET: t.string().when("NODE_ENV", "production", t.required()),
    };

    // development — STRIPE_SECRET absent — OK
    const env = EnvSchema.define(schema, { NODE_ENV: "development" });
    expect(env.STRIPE_SECRET).toBeUndefined();
  });

  it("error message names the condition", () => {
    const schema = {
      NODE_ENV: t.enum(["development", "production"] as const).required(),
      API_KEY: t.string().when("NODE_ENV", "production", t.required()),
    };
    const errs = errors(schema, { NODE_ENV: "production" });
    expect(errs[0]).toContain("NODE_ENV");
    expect(errs[0]).toContain("production");
  });
});

// ── Error collection ──────────────────────────────────────────────────────────

describe("EnvSchemaError — collects ALL failures", () => {
  it("reports multiple errors at once", () => {
    const schema = {
      DB_HOST: t.string().required(),
      DB_PASS: t.string().required(),
      PORT: t.number().required(),
    };
    const errs = errors(schema, { PORT: "not-a-number" });
    // DB_HOST, DB_PASS missing + PORT invalid = 3 errors
    expect(errs).toHaveLength(3);
  });

  it("throws EnvSchemaError (not a plain Error)", () => {
    let thrown: unknown;
    try {
      EnvSchema.define({ X: t.string().required() }, {});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EnvSchemaError);
    expect((thrown as EnvSchemaError).errors).toHaveLength(1);
  });

  it("error message contains all field names", () => {
    let msg = "";
    try {
      EnvSchema.define({ ALPHA: t.string().required(), BETA: t.string().required() }, {});
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("ALPHA");
    expect(msg).toContain("BETA");
  });
});

// ── Frozen output ─────────────────────────────────────────────────────────────

describe("EnvSchema.define() — frozen result", () => {
  it("returns a frozen read-only object", () => {
    const env = EnvSchema.define({ PORT: t.number().default(3000) }, {});
    expect(Object.isFrozen(env)).toBe(true);
    expect(() => {
      (env as Record<string, unknown>)["PORT"] = 9999;
    }).toThrow();
  });
});

// ── Type inference smoke tests (compile-time only) ────────────────────────────

describe("Type inference", () => {
  it("number().default() resolves to number (not number|undefined)", () => {
    const env = EnvSchema.define({ PORT: t.number().default(3000) }, {});
    // If PORT were number|undefined, the next line would be a TS error:
    const port: number = env.PORT;
    expect(port).toBe(3000);
  });

  it("string().required() resolves to string (not string|undefined)", () => {
    const env = EnvSchema.define({ HOST: t.string().required() }, { HOST: "localhost" });
    const host: string = env.HOST;
    expect(host).toBe("localhost");
  });

  it("string() without required resolves to string|undefined", () => {
    const env = EnvSchema.define({ OPT: t.string() }, {});
    // TypeScript type is string|undefined — accessing .length without a check should warn:
    const opt: string | undefined = env.OPT;
    expect(opt).toBeUndefined();
  });

  it("boolean().default() resolves to boolean", () => {
    const env = EnvSchema.define({ DEBUG: t.boolean().default(false) }, {});
    const debug: boolean = env.DEBUG;
    expect(debug).toBe(false);
  });
});
