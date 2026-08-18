import { describe, it, expect } from "bun:test";
import { RuleBuilder } from "./RuleBuilder.ts";
import { runValidation } from "./Validator.ts";
import { runStringRules } from "./stringRules.ts";
import { ValidatorFacade } from "./facades/Validator.ts";
import { ValidationRedirectError, ValidationJsonError } from "./ValidationError.ts";
import { ValidatorConfig } from "./config.ts";
import { registerDbRuleRunner, runDbRule, _resetDbRuleRunner } from "./dbRules.ts";
import { FormRequest } from "./FormRequest.ts";

const rules = new RuleBuilder();

// ── runValidation — string rules ──────────────────────────────────────────

describe("runValidation — string rules", () => {
  it("accepts a valid string", () => {
    const schema = { name: rules.string()._def };
    const r = runValidation(schema, { name: "Alice" });
    expect(r.success).toBe(true);
    expect((r as any).data.name).toBe("Alice");
  });

  it("rejects a missing required string", () => {
    const schema = { name: rules.string()._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(false);
    expect(r.errors?.name).toContain("required");
  });

  it("accepts missing optional field", () => {
    const schema = { bio: rules.string().optional()._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(true);
    expect((r as any).data.bio).toBeUndefined();
  });

  it("applies default value for missing optional field", () => {
    const schema = { role: rules.string().default("user")._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(true);
    expect((r as any).data.role).toBe("user");
  });

  it("rejects string shorter than min", () => {
    const schema = { name: rules.string().min(3)._def };
    const r = runValidation(schema, { name: "Al" });
    expect(r.success).toBe(false);
    expect(r.errors?.name).toContain("3");
  });

  it("uses custom error message for min", () => {
    const schema = { name: rules.string().min(5, "Name must be at least 5 chars")._def };
    const r = runValidation(schema, { name: "Al" });
    expect(r.success).toBe(false);
    expect(r.errors?.name).toBe("Name must be at least 5 chars");
  });

  it("rejects string longer than max", () => {
    const schema = { name: rules.string().max(5)._def };
    const r = runValidation(schema, { name: "Alexander" });
    expect(r.success).toBe(false);
    expect(r.errors?.name).toContain("5");
  });

  it("rejects invalid email", () => {
    const schema = { email: rules.string().email()._def };
    const r = runValidation(schema, { email: "not-an-email" });
    expect(r.success).toBe(false);
    expect(r.errors?.email).toContain("email");
  });

  it("accepts valid email", () => {
    const schema = { email: rules.string().email()._def };
    const r = runValidation(schema, { email: "siphesihle@example.com" });
    expect(r.success).toBe(true);
  });

  it("trims whitespace with trim()", () => {
    const schema = { name: rules.string().trim()._def };
    const r = runValidation(schema, { name: "  Alice  " });
    expect(r.success).toBe(true);
    expect((r as any).data.name).toBe("Alice");
  });

  it("converts to lowercase with lowercase()", () => {
    const schema = { tag: rules.string().lowercase()._def };
    const r = runValidation(schema, { tag: "HELLO" });
    expect((r as any).data.tag).toBe("hello");
  });

  it("rejects value not in allowed list", () => {
    const schema = { role: rules.string().in(["admin", "user"])._def };
    const r = runValidation(schema, { role: "superuser" });
    expect(r.success).toBe(false);
    expect(r.errors?.role).toContain("admin");
  });

  it("accepts value in allowed list", () => {
    const schema = { role: rules.string().in(["admin", "user"])._def };
    const r = runValidation(schema, { role: "admin" });
    expect(r.success).toBe(true);
  });

  it("validates confirmed field", () => {
    const schema = { password: rules.string().confirmed()._def };
    const r1 = runValidation(schema, {
      password: "secret",
      password_confirmation: "wrong",
    });
    expect(r1.success).toBe(false);

    const r2 = runValidation(schema, {
      password: "secret",
      password_confirmation: "secret",
    });
    expect(r2.success).toBe(true);
  });

  it("drops fields not in schema (mass assignment protection)", () => {
    const schema = { name: rules.string()._def };
    const r = runValidation(schema, { name: "Alice", role: "admin" });
    expect(r.success).toBe(true);
    expect((r as any).data.role).toBeUndefined();
  });
});

// ── runValidation — number rules ──────────────────────────────────────────

describe("runValidation — number rules", () => {
  it("accepts a valid number", () => {
    const schema = { age: rules.number()._def };
    const r = runValidation(schema, { age: 25 });
    expect(r.success).toBe(true);
    expect((r as any).data.age).toBe(25);
  });

  it("coerces numeric string to number", () => {
    const schema = { age: rules.number()._def };
    const r = runValidation(schema, { age: "25" });
    expect(r.success).toBe(true);
    expect((r as any).data.age).toBe(25);
  });

  it("rejects non-numeric string", () => {
    const schema = { age: rules.number()._def };
    const r = runValidation(schema, { age: "not-a-number" });
    expect(r.success).toBe(false);
  });

  it("rejects number below min", () => {
    const schema = { age: rules.number().min(18)._def };
    const r = runValidation(schema, { age: 15 });
    expect(r.success).toBe(false);
    expect(r.errors?.age).toContain("18");
  });

  it("rejects float when integer() required", () => {
    const schema = { count: rules.number().integer()._def };
    const r = runValidation(schema, { count: 3.5 });
    expect(r.success).toBe(false);
  });

  it("accepts integer when integer() required", () => {
    const schema = { count: rules.number().integer()._def };
    const r = runValidation(schema, { count: 3 });
    expect(r.success).toBe(true);
  });
});

// ── runValidation — boolean rules ─────────────────────────────────────────

describe("runValidation — boolean rules", () => {
  it("accepts true and false", () => {
    const schema = { active: rules.boolean()._def };
    expect(runValidation(schema, { active: true }).success).toBe(true);
    expect(runValidation(schema, { active: false }).success).toBe(true);
  });

  it('coerces "true" string to boolean', () => {
    const schema = { active: rules.boolean()._def };
    const r = runValidation(schema, { active: "true" });
    expect(r.success).toBe(true);
    expect((r as any).data.active).toBe(true);
  });
});

// ── runValidation — URL validation ────────────────────────────────────────

describe("runValidation — URL validation", () => {
  it("rejects invalid URL", () => {
    const schema = { website: rules.string().url()._def };
    const r = runValidation(schema, { website: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("accepts valid URL", () => {
    const schema = { website: rules.string().url()._def };
    const r = runValidation(schema, { website: "https://example.com" });
    expect(r.success).toBe(true);
  });
});

// ── ValidatorFacade.check() ────────────────────────────────────────────────

describe("ValidatorFacade.check()", () => {
  it("returns success:true for valid data", () => {
    const result = ValidatorFacade.check({ name: "Siphesihle", age: 25 }, (r) => ({
      name: r.string().min(2),
      age: r.number().min(0),
    }));
    expect(result.success).toBe(true);
  });

  it("returns success:false with errors for invalid data", () => {
    const result = ValidatorFacade.check({ name: "A", age: -1 }, (r) => ({
      name: r.string().min(2),
      age: r.number().min(0),
    }));
    expect(result.success).toBe(false);
    expect(result.errors?.name).toBeDefined();
    expect(result.errors?.age).toBeDefined();
  });

  it("never throws — always returns outcome object", () => {
    expect(() =>
      ValidatorFacade.check({}, (r) => ({
        required: r.string(),
      })),
    ).not.toThrow();
  });
});

// ── ValidationError classes ────────────────────────────────────────────────

describe("ValidationRedirectError", () => {
  it("has correct name, message, redirectTo, errors", () => {
    const err = new ValidationRedirectError("/login", { email: "Invalid" });
    expect(err.name).toBe("ValidationRedirectError");
    expect(err.redirectTo).toBe("/login");
    expect(err.errors.email).toBe("Invalid");
    expect(err instanceof Error).toBe(true);
  });
});

describe("ValidationJsonError", () => {
  it("has correct name, message, errors", () => {
    const err = new ValidationJsonError({ email: "Required" });
    expect(err.name).toBe("ValidationJsonError");
    expect(err.errors.email).toBe("Required");
    expect(err instanceof Error).toBe(true);
  });
});

// ── RuleBuilder shorthands ─────────────────────────────────────────────────

describe("RuleBuilder shorthands", () => {
  it("email() === string().email()", () => {
    const r1 = new RuleBuilder();
    const a = r1.email();
    const b = r1.string().email();
    expect(a._def.type).toBe("string");
    expect(a._def.rules.find((r) => r.name === "email")).toBeDefined();
    expect(b._def.rules.find((r) => r.name === "email")).toBeDefined();
  });

  it("uuid() adds uuid rule", () => {
    const rule = new RuleBuilder().uuid();
    expect(rule._def.type).toBe("string");
    expect(rule._def.rules.find((r) => r.name === "regex")).toBeDefined();
  });
});

// ── ValidatorConfig factory ───────────────────────────────────────────────────

describe("ValidatorConfig", () => {
  it("returns defaults when called with no arguments", () => {
    const cfg = ValidatorConfig();
    expect(cfg.stopOnFirstFailure).toBe(true);
    expect(cfg.locale).toBe("en");
  });

  it("overrides work", () => {
    const cfg = ValidatorConfig({ locale: "af" });
    expect(cfg.locale).toBe("af");
    expect(cfg.stopOnFirstFailure).toBe(true);
  });
});

// ── sometimes() ──────────────────────────────────────────────────────────────

describe("sometimes()", () => {
  it("skips the field entirely when absent", () => {
    const schema = { bio: rules.string().sometimes().max(500)._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(true);
    expect("bio" in ((r as any).data ?? {})).toBe(false);
  });

  it("validates when the field is present", () => {
    const schema = { bio: rules.string().sometimes().max(3)._def };
    const r = runValidation(schema, { bio: "toolong" });
    expect(r.success).toBe(false);
    expect(r.errors?.bio).toContain("3");
  });

  it("passes when field is present and valid", () => {
    const schema = { bio: rules.string().sometimes().max(500)._def };
    const r = runValidation(schema, { bio: "hello" });
    expect(r.success).toBe(true);
    expect((r as any).data.bio).toBe("hello");
  });
});

// ── requiredIf() ──────────────────────────────────────────────────────────────

describe("requiredIf()", () => {
  it("is required when condition field matches", () => {
    const schema = {
      shipping: rules.boolean()._def,
      address: rules.string().requiredIf("shipping", true)._def,
    };
    const r = runValidation(schema, { shipping: true });
    expect(r.success).toBe(false);
    expect(r.errors?.address).toContain("required");
  });

  it("is not required when condition field does not match", () => {
    const schema = {
      shipping: rules.boolean()._def,
      address: rules.string().requiredIf("shipping", true)._def,
    };
    const r = runValidation(schema, { shipping: false });
    expect(r.success).toBe(true);
  });

  it("supports a callback form", () => {
    const schema = {
      role: rules.string()._def,
      perms: rules.string().requiredIf((input) => input["role"] === "admin")._def,
    };
    const r = runValidation(schema, { role: "admin" });
    expect(r.success).toBe(false);
    expect(r.errors?.perms).toContain("required");
  });

  it("callback: not required when condition returns false", () => {
    const schema = {
      role: rules.string()._def,
      perms: rules.string().requiredIf((input) => input["role"] === "admin")._def,
    };
    expect(runValidation(schema, { role: "user", perms: undefined }).success).toBe(true);
  });
});

// ── requiredUnless() ──────────────────────────────────────────────────────────

describe("requiredUnless()", () => {
  it("is required unless the condition field matches", () => {
    const schema = {
      method: rules.string()._def,
      phone: rules.string().requiredUnless("method", "email")._def,
    };
    const r = runValidation(schema, { method: "sms" });
    expect(r.success).toBe(false);
    expect(r.errors?.phone).toContain("required");
  });

  it("is not required when the condition field matches", () => {
    const schema = {
      method: rules.string()._def,
      phone: rules.string().requiredUnless("method", "email")._def,
    };
    expect(runValidation(schema, { method: "email" }).success).toBe(true);
  });
});

// ── accepted() / declined() ───────────────────────────────────────────────────

describe("accepted()", () => {
  it.each([[true], [1], ["1"], ["yes"], ["on"], ["true"]])("accepts %s", (val) => {
    const schema = { terms: rules.boolean().accepted()._def };
    expect(runValidation(schema, { terms: val }).success).toBe(true);
  });

  it("rejects false", () => {
    const schema = { terms: rules.boolean().accepted()._def };
    const r = runValidation(schema, { terms: false });
    expect(r.success).toBe(false);
    expect(r.errors?.terms).toContain("accepted");
  });
});

describe("declined()", () => {
  it.each([[false], [0], ["0"], ["no"], ["off"], ["false"]])("accepts %s", (val) => {
    const schema = { marketing: rules.boolean().declined()._def };
    expect(runValidation(schema, { marketing: val }).success).toBe(true);
  });

  it("rejects true", () => {
    const schema = { marketing: rules.boolean().declined()._def };
    const r = runValidation(schema, { marketing: true });
    expect(r.success).toBe(false);
    expect(r.errors?.marketing).toContain("declined");
  });
});

// ── notIn() ──────────────────────────────────────────────────────────────────

describe("notIn()", () => {
  it("rejects a value in the exclusion list", () => {
    const schema = { username: rules.string().notIn(["admin", "root"])._def };
    const r = runValidation(schema, { username: "admin" });
    expect(r.success).toBe(false);
  });

  it("passes a value not in the exclusion list", () => {
    const schema = { username: rules.string().notIn(["admin", "root"])._def };
    expect(runValidation(schema, { username: "alice" }).success).toBe(true);
  });
});

// ── sameAs() ─────────────────────────────────────────────────────────────────

describe("sameAs()", () => {
  it("passes when both fields match", () => {
    const schema = {
      password: rules.string()._def,
      password_confirmation: rules.string().sameAs("password")._def,
    };
    const r = runValidation(schema, { password: "secret", password_confirmation: "secret" });
    expect(r.success).toBe(true);
  });

  it("fails when fields do not match", () => {
    const schema = {
      password: rules.string()._def,
      password_confirmation: rules.string().sameAs("password")._def,
    };
    const r = runValidation(schema, { password: "secret", password_confirmation: "wrong" });
    expect(r.success).toBe(false);
    expect(r.errors?.password_confirmation).toContain("password");
  });
});

// ── alpha / alphaNum / alphaDash ─────────────────────────────────────────────

describe("alpha()", () => {
  it("accepts letters only", () => {
    expect(runValidation({ name: rules.string().alpha()._def }, { name: "Alice" }).success).toBe(
      true,
    );
  });
  it("rejects digits", () => {
    expect(runValidation({ name: rules.string().alpha()._def }, { name: "Alice1" }).success).toBe(
      false,
    );
  });
});

describe("alphaNum()", () => {
  it("accepts letters and digits", () => {
    expect(
      runValidation({ code: rules.string().alphaNum()._def }, { code: "abc123" }).success,
    ).toBe(true);
  });
  it("rejects hyphens", () => {
    expect(
      runValidation({ code: rules.string().alphaNum()._def }, { code: "abc-123" }).success,
    ).toBe(false);
  });
});

describe("alphaDash()", () => {
  it("accepts letters, digits, hyphens, underscores", () => {
    expect(
      runValidation({ slug: rules.string().alphaDash()._def }, { slug: "my-slug_2" }).success,
    ).toBe(true);
  });
  it("rejects spaces", () => {
    expect(
      runValidation({ slug: rules.string().alphaDash()._def }, { slug: "my slug" }).success,
    ).toBe(false);
  });
});

// ── startsWith / endsWith / size ─────────────────────────────────────────────

describe("startsWith()", () => {
  it("passes when string starts with prefix", () => {
    expect(
      runValidation({ code: rules.string().startsWith("INV-")._def }, { code: "INV-001" }).success,
    ).toBe(true);
  });
  it("fails when prefix missing", () => {
    expect(
      runValidation({ code: rules.string().startsWith("INV-")._def }, { code: "001" }).success,
    ).toBe(false);
  });
});

describe("endsWith()", () => {
  it("passes when string ends with suffix", () => {
    expect(
      runValidation({ file: rules.string().endsWith(".pdf")._def }, { file: "report.pdf" }).success,
    ).toBe(true);
  });
  it("fails when suffix missing", () => {
    expect(
      runValidation({ file: rules.string().endsWith(".pdf")._def }, { file: "report.doc" }).success,
    ).toBe(false);
  });
});

describe("size()", () => {
  it("passes for exact string length", () => {
    expect(runValidation({ code: rules.string().size(6)._def }, { code: "ABCDEF" }).success).toBe(
      true,
    );
  });
  it("fails for wrong string length", () => {
    expect(runValidation({ code: rules.string().size(6)._def }, { code: "ABC" }).success).toBe(
      false,
    );
  });
  it("passes for exact array size", () => {
    expect(
      runValidation({ tags: rules.array(rules.string()).size(2)._def }, { tags: ["a", "b"] })
        .success,
    ).toBe(true);
  });
});

// ── between() ────────────────────────────────────────────────────────────────

describe("between()", () => {
  it("passes when number is in range", () => {
    expect(runValidation({ score: rules.number().between(1, 10)._def }, { score: 5 }).success).toBe(
      true,
    );
  });
  it("fails when below range", () => {
    expect(runValidation({ score: rules.number().between(1, 10)._def }, { score: 0 }).success).toBe(
      false,
    );
  });
  it("fails when above range", () => {
    expect(
      runValidation({ score: rules.number().between(1, 10)._def }, { score: 11 }).success,
    ).toBe(false);
  });
  it("accepts boundary values", () => {
    const schema = { score: rules.number().between(1, 10)._def };
    expect(runValidation(schema, { score: 1 }).success).toBe(true);
    expect(runValidation(schema, { score: 10 }).success).toBe(true);
  });
});

// ── custom() async ────────────────────────────────────────────────────────────

describe("custom() async validation", () => {
  it("passes when fn returns true", async () => {
    const { runValidationAsync } = await import("./Validator.ts");
    const schema = { name: rules.string().custom(async () => true)._def };
    const r = await runValidationAsync(schema, { name: "Alice" });
    expect(r.success).toBe(true);
  });

  it("fails when fn returns false (generic message)", async () => {
    const { runValidationAsync } = await import("./Validator.ts");
    const schema = { name: rules.string().custom(async () => false)._def };
    const r = await runValidationAsync(schema, { name: "Alice" });
    expect(r.success).toBe(false);
    expect(r.errors?.name).toContain("invalid");
  });

  it("fails with fn-returned string as message", async () => {
    const { runValidationAsync } = await import("./Validator.ts");
    const schema = { name: rules.string().custom(async () => "Name is reserved.")._def };
    const r = await runValidationAsync(schema, { name: "admin" });
    expect(r.success).toBe(false);
    expect(r.errors?.name).toBe("Name is reserved.");
  });

  it("passes synchronous true return", async () => {
    const { runValidationAsync } = await import("./Validator.ts");
    const schema = { code: rules.string().custom(() => true)._def };
    const r = await runValidationAsync(schema, { code: "ok" });
    expect(r.success).toBe(true);
  });

  it("receives the full input object", async () => {
    const { runValidationAsync } = await import("./Validator.ts");
    let capturedInput: Record<string, unknown> | undefined;
    const schema = {
      a: rules.string()._def,
      b: rules.string().custom((_v, input) => {
        capturedInput = input;
        return true;
      })._def,
    };
    await runValidationAsync(schema, { a: "x", b: "y" });
    expect(capturedInput?.a).toBe("x");
  });
});

// ── unique() positional ignoreId ──────────────────────────────────────────────

describe("unique() positional ignoreId", () => {
  it("stores a plain string ID as { ignoreId }", () => {
    const def = rules.string().unique("users", "email", "uuid-123")._def;
    const rule = def.rules.find((r) => r.name === "unique");
    expect((rule!.args[2] as Record<string, unknown>)["ignoreId"]).toBe("uuid-123");
  });

  it("stores a plain number ID as { ignoreId }", () => {
    const def = rules.string().unique("users", "email", 42)._def;
    const rule = def.rules.find((r) => r.name === "unique");
    expect((rule!.args[2] as Record<string, unknown>)["ignoreId"]).toBe(42);
  });

  it("passes through a UniqueOptions object unchanged", () => {
    const def = rules.string().unique("users", "email", { ignoreId: 7 })._def;
    const rule = def.rules.find((r) => r.name === "unique");
    expect((rule!.args[2] as Record<string, unknown>)["ignoreId"]).toBe(7);
  });

  it("allows chaining after unique()", () => {
    const def = rules.string().unique("users", "email", 1).email("Bad email")._def;
    expect(def.rules.find((r) => r.name === "unique")).toBeDefined();
    expect(def.rules.find((r) => r.name === "email")).toBeDefined();
  });
});

// ── matches() alias ───────────────────────────────────────────────────────────

describe("matches()", () => {
  it("is an alias for regex()", () => {
    const def = rules.string().matches(/^[A-Z]+$/)._def;
    expect(def.rules.find((r) => r.name === "regex")).toBeDefined();
  });

  it("passes a matching value", () => {
    const schema = { code: rules.string().matches(/^[A-Z]{3}$/)._def };
    expect(runValidation(schema, { code: "ABC" }).success).toBe(true);
  });

  it("rejects a non-matching value with custom message", () => {
    const schema = {
      code: rules.string().matches(/^[A-Z]{3}$/, "Must be 3 uppercase letters")._def,
    };
    const r = runValidation(schema, { code: "abc" });
    expect(r.success).toBe(false);
    expect(r.errors?.code).toBe("Must be 3 uppercase letters");
  });
});

// ── password() marker ─────────────────────────────────────────────────────────

describe("password()", () => {
  it("is chainable", () => {
    const def = rules.string().password().min(8).max(128)._def;
    expect(def.rules.find((r) => r.name === "min")).toBeDefined();
    expect(def.rules.find((r) => r.name === "max")).toBeDefined();
  });

  it("works with matches() for complexity requirements", () => {
    const schema = {
      password: rules
        .string()
        .password()
        .min(8)
        .max(128)
        .matches(/^(?=.*[A-Z])(?=.*\d).+$/, "Must contain uppercase and digit")._def,
    };
    expect(runValidation(schema, { password: "Secret1!" }).success).toBe(true);
    const r = runValidation(schema, { password: "alllower1" });
    expect(r.success).toBe(false);
    expect(r.errors?.password).toBe("Must contain uppercase and digit");
  });

  it("full user example chains work end-to-end", () => {
    const schema1 = {
      email: rules.string().exists("users", "email").email("Invalid email address")._def,
    };
    // exists() stores async rule; email() stores sync rule
    expect(schema1.email.rules.find((r) => r.name === "exists")).toBeDefined();
    expect(schema1.email.rules.find((r) => r.name === "email")).toBeDefined();

    const schema2 = {
      url: rules.string().unique("pages", "slug", "old-id").url("Invalid URL")._def,
    };
    expect(schema2.url.rules.find((r) => r.name === "unique")).toBeDefined();
    expect(schema2.url.rules.find((r) => r.name === "url")).toBeDefined();
    expect(
      (schema2.url.rules.find((r) => r.name === "unique")!.args[2] as Record<string, unknown>)[
        "ignoreId"
      ],
    ).toBe("old-id");
  });
});

// ── DateRule ──────────────────────────────────────────────────────────────────

describe("runValidation — date rules", () => {
  it("accepts a valid date string and coerces to Date", () => {
    const schema = { dob: rules.date()._def };
    const r = runValidation(schema, { dob: "2000-06-15" });
    expect(r.success).toBe(true);
    expect((r as any).data.dob).toBeInstanceOf(Date);
  });

  it("accepts a Date instance directly", () => {
    const schema = { dob: rules.date()._def };
    const d = new Date("2000-01-01");
    const r = runValidation(schema, { dob: d });
    expect(r.success).toBe(true);
    expect((r as any).data.dob).toBeInstanceOf(Date);
  });

  it("rejects an invalid date string", () => {
    const schema = { dob: rules.date()._def };
    const r = runValidation(schema, { dob: "not-a-date" });
    expect(r.success).toBe(false);
    expect(r.errors?.dob).toContain("valid date");
  });

  it("rejects a missing required date", () => {
    const schema = { dob: rules.date()._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(false);
    expect(r.errors?.dob).toContain("required");
  });

  it("accepts missing optional date", () => {
    const schema = { dob: rules.date().optional()._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(true);
  });

  it("after() rejects a date not after the reference", () => {
    const schema = { dt: rules.date().after("2023-01-01")._def };
    const r = runValidation(schema, { dt: "2022-12-31" });
    expect(r.success).toBe(false);
    expect(r.errors?.dt).toContain("after");
  });

  it("after() accepts a date strictly after the reference", () => {
    const schema = { dt: rules.date().after("2023-01-01")._def };
    const r = runValidation(schema, { dt: "2023-06-01" });
    expect(r.success).toBe(true);
  });

  it("after() rejects a date equal to the reference (exclusive)", () => {
    const schema = { dt: rules.date().after("2023-01-01")._def };
    const r = runValidation(schema, { dt: "2023-01-01" });
    expect(r.success).toBe(false);
  });

  it("before() rejects a date not before the reference", () => {
    const schema = { dt: rules.date().before("2023-01-01")._def };
    const r = runValidation(schema, { dt: "2023-06-01" });
    expect(r.success).toBe(false);
    expect(r.errors?.dt).toContain("before");
  });

  it("before() accepts a date strictly before the reference", () => {
    const schema = { dt: rules.date().before("2023-06-01")._def };
    const r = runValidation(schema, { dt: "2023-01-01" });
    expect(r.success).toBe(true);
  });

  it("afterOrEqual() accepts a date equal to the reference", () => {
    const schema = { dt: rules.date().afterOrEqual("2023-01-01")._def };
    const r = runValidation(schema, { dt: "2023-01-01" });
    expect(r.success).toBe(true);
  });

  it("afterOrEqual() rejects a date before the reference", () => {
    const schema = { dt: rules.date().afterOrEqual("2023-01-01")._def };
    const r = runValidation(schema, { dt: "2022-12-31" });
    expect(r.success).toBe(false);
    expect(r.errors?.dt).toContain("on or after");
  });

  it("beforeOrEqual() accepts a date equal to the reference", () => {
    const schema = { dt: rules.date().beforeOrEqual("2023-12-31")._def };
    const r = runValidation(schema, { dt: "2023-12-31" });
    expect(r.success).toBe(true);
  });

  it("beforeOrEqual() rejects a date after the reference", () => {
    const schema = { dt: rules.date().beforeOrEqual("2023-12-31")._def };
    const r = runValidation(schema, { dt: "2024-01-01" });
    expect(r.success).toBe(false);
    expect(r.errors?.dt).toContain("on or before");
  });

  it("accepts a Date object for after() reference", () => {
    const ref = new Date("2020-01-01");
    const schema = { dt: rules.date().after(ref)._def };
    const r = runValidation(schema, { dt: "2021-01-01" });
    expect(r.success).toBe(true);
  });

  it("uses custom message on failure", () => {
    const schema = { dt: rules.date().after("2025-01-01", "Too old")._def };
    const r = runValidation(schema, { dt: "2020-01-01" });
    expect(r.success).toBe(false);
    expect(r.errors?.dt).toBe("Too old");
  });
});

// ── FileRule ──────────────────────────────────────────────────────────────────

function makeFile(
  name: string,
  size: number,
  type = "image/jpeg",
): { name: string; size: number; type: string } {
  return { name, size, type };
}

describe("runValidation — file rules", () => {
  it("accepts a valid file-like object", () => {
    const schema = { avatar: rules.file()._def };
    const r = runValidation(schema, { avatar: makeFile("photo.jpg", 1024) });
    expect(r.success).toBe(true);
  });

  it("rejects a non-file value", () => {
    const schema = { avatar: rules.file()._def };
    const r = runValidation(schema, { avatar: "not-a-file" });
    expect(r.success).toBe(false);
    expect(r.errors?.avatar).toContain("file");
  });

  it("mimes() accepts allowed extension", () => {
    const schema = { photo: rules.file().mimes(["jpg", "png"])._def };
    const r = runValidation(schema, { photo: makeFile("photo.jpg", 1024) });
    expect(r.success).toBe(true);
  });

  it("mimes() rejects disallowed extension", () => {
    const schema = { photo: rules.file().mimes(["jpg", "png"])._def };
    const r = runValidation(schema, { photo: makeFile("doc.pdf", 1024) });
    expect(r.success).toBe(false);
    expect(r.errors?.photo).toContain("jpg, png");
  });

  it("max() rejects file over size limit", () => {
    const schema = { photo: rules.file().max(1)._def }; // max 1 KB
    const r = runValidation(schema, { photo: makeFile("big.jpg", 2048) }); // 2 KB
    expect(r.success).toBe(false);
    expect(r.errors?.photo).toContain("1 KB");
  });

  it("max() accepts file within size limit", () => {
    const schema = { photo: rules.file().max(5)._def }; // max 5 KB
    const r = runValidation(schema, { photo: makeFile("small.jpg", 4096) }); // 4 KB
    expect(r.success).toBe(true);
  });

  it("min() rejects file under size minimum", () => {
    const schema = { video: rules.file().min(100)._def }; // min 100 KB
    const r = runValidation(schema, { video: makeFile("tiny.mp4", 1024) }); // 1 KB
    expect(r.success).toBe(false);
    expect(r.errors?.video).toContain("100 KB");
  });
});

// ── PasswordRule ──────────────────────────────────────────────────────────────

describe("runValidation — password rules", () => {
  it("accepts a strong password", () => {
    const schema = { pw: rules.password().min(8).mixedCase().numbers().symbols()._def };
    const r = runValidation(schema, { pw: "Hello@123" });
    expect(r.success).toBe(true);
  });

  it("rejects password shorter than min", () => {
    const schema = { pw: rules.password().min(12)._def };
    const r = runValidation(schema, { pw: "Short1!" });
    expect(r.success).toBe(false);
  });

  it("mixedCase() rejects all-lowercase", () => {
    const schema = { pw: rules.password().mixedCase()._def };
    const r = runValidation(schema, { pw: "alllowercase" });
    expect(r.success).toBe(false);
    expect(r.errors?.pw).toContain("uppercase");
  });

  it("numbers() rejects password without digits", () => {
    const schema = { pw: rules.password().numbers()._def };
    const r = runValidation(schema, { pw: "NoDigitsHere" });
    expect(r.success).toBe(false);
    expect(r.errors?.pw).toContain("number");
  });

  it("symbols() rejects password without symbols", () => {
    const schema = { pw: rules.password().symbols()._def };
    const r = runValidation(schema, { pw: "NoSymbols123" });
    expect(r.success).toBe(false);
    expect(r.errors?.pw).toContain("symbol");
  });

  it("uncompromised() rejects password with spaces", () => {
    const schema = { pw: rules.password().uncompromised()._def };
    const r = runValidation(schema, { pw: "Has Space1!" });
    expect(r.success).toBe(false);
    expect(r.errors?.pw).toContain("spaces");
  });
});

// ── Extra string rules ────────────────────────────────────────────────────────

describe("runValidation — extra string rules", () => {
  it("ip() accepts valid IPv4", () => {
    const schema = { addr: rules.string().ip()._def };
    const r = runValidation(schema, { addr: "192.168.1.1" });
    expect(r.success).toBe(true);
  });

  it("ip() rejects non-IP string", () => {
    const schema = { addr: rules.string().ip()._def };
    const r = runValidation(schema, { addr: "not-an-ip" });
    expect(r.success).toBe(false);
    expect(r.errors?.addr).toContain("IP");
  });

  it("json() accepts valid JSON string", () => {
    const schema = { data: rules.string().json()._def };
    const r = runValidation(schema, { data: '{"key":"value"}' });
    expect(r.success).toBe(true);
  });

  it("json() rejects invalid JSON", () => {
    const schema = { data: rules.string().json()._def };
    const r = runValidation(schema, { data: "{invalid}" });
    expect(r.success).toBe(false);
    expect(r.errors?.data).toContain("JSON");
  });

  it("digits() accepts exact digit count", () => {
    const schema = { code: rules.string().digits(6)._def };
    const r = runValidation(schema, { code: "123456" });
    expect(r.success).toBe(true);
  });

  it("digits() rejects wrong digit count", () => {
    const schema = { code: rules.string().digits(6)._def };
    const r = runValidation(schema, { code: "1234" });
    expect(r.success).toBe(false);
  });

  it("digitsBetween() accepts valid range", () => {
    const schema = { pin: rules.string().digitsBetween(4, 6)._def };
    const r = runValidation(schema, { pin: "12345" });
    expect(r.success).toBe(true);
  });

  it("digitsBetween() rejects out of range", () => {
    const schema = { pin: rules.string().digitsBetween(4, 6)._def };
    const r = runValidation(schema, { pin: "123" });
    expect(r.success).toBe(false);
  });

  it("numeric() accepts numeric string", () => {
    const schema = { amount: rules.string().numeric()._def };
    const r = runValidation(schema, { amount: "123.45" });
    expect(r.success).toBe(true);
  });

  it("numeric() rejects non-numeric string", () => {
    const schema = { amount: rules.string().numeric()._def };
    const r = runValidation(schema, { amount: "12abc" });
    expect(r.success).toBe(false);
    expect(r.errors?.amount).toContain("numeric");
  });
});

// ── prohibited / present rules ────────────────────────────────────────────────

describe("runValidation — prohibited / present", () => {
  it("prohibited() fails when field IS present", () => {
    const schema = { admin: rules.string().prohibited()._def };
    const r = runValidation(schema, { admin: "yes" });
    expect(r.success).toBe(false);
    expect(r.errors?.admin).toContain("not be present");
  });

  it("prohibited() passes when field is absent", () => {
    const schema = { admin: rules.string().prohibited()._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(true);
  });

  it("present() passes when field key exists", () => {
    const schema = { meta: rules.string().present().optional()._def };
    const r = runValidation(schema, { meta: "" });
    expect(r.success).toBe(true);
  });

  it("present() fails when field key is absent", () => {
    const schema = { meta: rules.string().present()._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(false);
    expect(r.errors?.meta).toContain("must be present");
  });
});

// ── requiredWith / requiredWithout ────────────────────────────────────────────

describe("runValidation — requiredWith / requiredWithout", () => {
  it("requiredWith(): required when a listed field is present", () => {
    const schema = { cvv: rules.string().requiredWith(["cardNumber"])._def };
    const r = runValidation(schema, { cardNumber: "4111" });
    expect(r.success).toBe(false);
    expect(r.errors?.cvv).toContain("required");
  });

  it("requiredWith(): not required when none of the listed fields are present", () => {
    const schema = { cvv: rules.string().requiredWith(["cardNumber"])._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(true);
  });

  it("requiredWith(): passes when field is present and listed field is present", () => {
    const schema = { cvv: rules.string().requiredWith(["cardNumber"])._def };
    const r = runValidation(schema, { cardNumber: "4111", cvv: "123" });
    expect(r.success).toBe(true);
  });

  it("requiredWithout(): required when a listed field is absent", () => {
    const schema = { email: rules.string().requiredWithout(["phone"])._def };
    const r = runValidation(schema, {}); // phone absent → email required
    expect(r.success).toBe(false);
    expect(r.errors?.email).toContain("required");
  });

  it("requiredWithout(): not required when listed field is present", () => {
    const schema = { email: rules.string().requiredWithout(["phone"])._def };
    const r = runValidation(schema, { phone: "555-1234" });
    expect(r.success).toBe(true);
  });

  it("requiredWithAll(): required only when ALL listed fields are present", () => {
    const schema = { confirm: rules.string().requiredWithAll(["a", "b"])._def };
    const r1 = runValidation(schema, { a: "1", b: "2" });
    expect(r1.success).toBe(false); // both present → required

    const r2 = runValidation(schema, { a: "1" }); // only one present
    expect(r2.success).toBe(true);
  });

  it("requiredWithoutAll(): required only when ALL listed fields are absent", () => {
    const schema = { fallback: rules.string().requiredWithoutAll(["x", "y"])._def };
    const r1 = runValidation(schema, {}); // both absent → required
    expect(r1.success).toBe(false);

    const r2 = runValidation(schema, { x: "1" }); // one present → not required
    expect(r2.success).toBe(true);
  });
});

// ── prohibitedIf / prohibitedUnless ───────────────────────────────────────────

describe("runValidation — prohibitedIf / prohibitedUnless", () => {
  it("prohibitedIf(): fails when condition matches and field is present", () => {
    const schema = { adminCode: rules.string().prohibitedIf("role", "guest")._def };
    const r = runValidation(schema, { role: "guest", adminCode: "secret" });
    expect(r.success).toBe(false);
    expect(r.errors?.adminCode).toContain("must not be present");
  });

  it("prohibitedIf(): passes when condition does not match", () => {
    const schema = { adminCode: rules.string().prohibitedIf("role", "guest")._def };
    const r = runValidation(schema, { role: "admin", adminCode: "secret" });
    expect(r.success).toBe(true);
  });

  it("prohibitedIf(): passes when field is absent (even if condition matches)", () => {
    const schema = { adminCode: rules.string().optional().prohibitedIf("role", "guest")._def };
    const r = runValidation(schema, { role: "guest" }); // no adminCode
    expect(r.success).toBe(true);
  });

  it("prohibitedUnless(): fails when condition does NOT match and field is present", () => {
    const schema = { discount: rules.number().prohibitedUnless("role", "admin")._def };
    const r = runValidation(schema, { role: "user", discount: 10 });
    expect(r.success).toBe(false);
    expect(r.errors?.discount).toContain("must not be present");
  });

  it("prohibitedUnless(): passes when condition matches", () => {
    const schema = { discount: rules.number().prohibitedUnless("role", "admin")._def };
    const r = runValidation(schema, { role: "admin", discount: 10 });
    expect(r.success).toBe(true);
  });
});

// ── bail() ────────────────────────────────────────────────────────────────────

describe("runValidation — bail()", () => {
  it("bail() skips the field's remaining rules after the first failure", () => {
    const schema = {
      username: rules.string().min(5).alphaNum().bail()._def,
    };
    const r = runValidation(schema, { username: "a!" });
    // "a!" fails min(5) AND alphaNum() — bail keeps only the first failure
    expect(r.success).toBe(false);
    expect(r.errors?.username).toContain("at least 5");
    expect(r.errors?.username).not.toContain("letters and numbers");
  });

  it("bail() on one field does NOT stop other fields being validated", () => {
    const schema = {
      email: rules.string().email().bail()._def,
      name: rules.string()._def,
    };
    const r = runValidation(schema, { email: "bad", name: "" });
    expect(r.success).toBe(false);
    expect(r.errors?.email).toBeDefined();
    expect(r.errors?.name).toBeDefined(); // still checked despite email's bail
  });

  it("without bail(), all failing rules for a field are collected", () => {
    const schema = {
      username: rules.string().min(5).alphaNum()._def,
    };
    const r = runValidation(schema, { username: "a!" });
    expect(r.success).toBe(false);
    expect(r.errors?.username).toContain("at least 5");
    expect(r.errors?.username).toContain("letters and numbers");
  });

  it("without bail(), all field errors are collected", () => {
    const schema = {
      email: rules.string().email()._def,
      name: rules.string()._def,
    };
    const r = runValidation(schema, { email: "bad", name: "" });
    expect(r.success).toBe(false);
    expect(r.errors?.email).toBeDefined();
    expect(r.errors?.name).toBeDefined(); // also collected
  });
});

// ── Unknown rule names ────────────────────────────────────────────────────────

describe("runValidation — unknown rules", () => {
  it("throws a clear error instead of silently passing", () => {
    const def = rules.string()._def;
    def.rules.push({ name: "definitelyNotARule", args: [] });
    expect(() => runValidation({ nickname: def }, { nickname: "zerotal" })).toThrow(
      /definitelyNotARule/,
    );
  });
});

// ── Single rule engine — schema API and string rules must agree ───────────────

describe("rule engine parity (schema API vs string rules)", () => {
  it("email validates identically via both entry points", () => {
    const samples = [
      "user@example.com",
      "user.name+tag@sub.example.co.za",
      "bad",
      "a@b",
      "with space@example.com",
      "double@@example.com",
      "@example.com",
      "user@.com",
    ];
    for (const sample of samples) {
      const viaSchema = runValidation(
        { email: rules.string().email()._def },
        { email: sample },
      ).success;
      const viaStringRules =
        Object.keys(runStringRules({ email: sample }, { email: "email" })).length === 0;
      expect(`${sample}:${viaSchema}`).toBe(`${sample}:${viaStringRules}`);
    }
  });
});
// ── RuleBuilder.url() ─────────────────────────────────────────────────────────

describe("RuleBuilder.url()", () => {
  it("rejects non-URL string", () => {
    const schema = { site: rules.url()._def };
    const r = runValidation(schema, { site: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("accepts a valid URL", () => {
    const schema = { site: rules.url()._def };
    const r = runValidation(schema, { site: "https://example.com" });
    expect(r.success).toBe(true);
  });
});

// ── FieldRule base — optional() / nullable() ──────────────────────────────────

describe("FieldRule — optional() and nullable()", () => {
  it("optional() allows missing field", () => {
    const schema = { name: rules.string().optional()._def };
    const r = runValidation(schema, {});
    expect(r.success).toBe(true);
  });

  it("nullable() sets the nullable flag on the rule definition", () => {
    const rule = rules.string().nullable();
    expect(rule._def.nullable).toBe(true);
  });
});

// ── The empty string an HTML form sends for "no value" ─────────────────────

describe("optional fields and the empty string", () => {
  it("reads an empty string as absent for an optional number", () => {
    // What every `<option value="">Unassigned</option>` posts.
    const schema = { assignee: rules.number().optional()._def };
    const r = runValidation(schema, { assignee: "" });
    expect(r.success).toBe(true);
    expect("assignee" in (r as any).data).toBe(false);
  });

  it("clears rather than skips when the field is nullable too", () => {
    // Skipping would leave the previous assignee in place and report success.
    const schema = { assignee: rules.number().optional().nullable()._def };
    const r = runValidation(schema, { assignee: "" });
    expect(r.success).toBe(true);
    expect((r as any).data.assignee).toBeNull();
  });

  it("reads an empty string as absent for an optional date", () => {
    const schema = { dueAt: rules.date().optional()._def };
    const r = runValidation(schema, { dueAt: "" });
    expect(r.success).toBe(true);
    expect("dueAt" in (r as any).data).toBe(false);
  });

  it("leaves it alone for a string, where it may be the value someone meant", () => {
    const schema = { bio: rules.string().optional()._def };
    const r = runValidation(schema, { bio: "" });
    expect(r.success).toBe(true);
    expect((r as any).data.bio).toBe("");
  });

  it("still refuses an empty string on a required number", () => {
    const schema = { qty: rules.number()._def };
    const r = runValidation(schema, { qty: "" });
    expect(r.success).toBe(false);
    expect((r as any).errors.qty).toContain("required");
  });

  it("still refuses a non-numeric string on an optional number", () => {
    // The widening is only about "", not about what a number accepts.
    const schema = { qty: rules.number().optional()._def };
    const r = runValidation(schema, { qty: "abc" });
    expect(r.success).toBe(false);
  });
});

// ── StringRule — uppercase() ──────────────────────────────────────────────────

describe("StringRule.uppercase()", () => {
  it("transforms the value to uppercase", () => {
    const schema = { code: rules.string().uppercase()._def };
    const r = runValidation(schema, { code: "abc" });
    expect(r.success).toBe(true);
    expect((r as any).data.code).toBe("ABC");
  });
});

// ── NumberRule — max() / positive() / between() ───────────────────────────────

describe("NumberRule.max()", () => {
  it("rejects a value above max", () => {
    const schema = { qty: rules.number().max(10)._def };
    const r = runValidation(schema, { qty: 20 });
    expect(r.success).toBe(false);
  });

  it("accepts a value within max", () => {
    const schema = { qty: rules.number().max(10)._def };
    const r = runValidation(schema, { qty: 5 });
    expect(r.success).toBe(true);
  });
});

describe("NumberRule.positive()", () => {
  it("rejects negative numbers", () => {
    const schema = { val: rules.number().positive()._def };
    const r = runValidation(schema, { val: -1 });
    expect(r.success).toBe(false);
  });

  it("accepts positive numbers", () => {
    const schema = { val: rules.number().positive()._def };
    const r = runValidation(schema, { val: 5 });
    expect(r.success).toBe(true);
  });
});

describe("NumberRule.between()", () => {
  it("rejects a value outside the range", () => {
    const schema = { score: rules.number().between(1, 100)._def };
    const r = runValidation(schema, { score: 101 });
    expect(r.success).toBe(false);
  });

  it("accepts a value inside the range", () => {
    const schema = { score: rules.number().between(1, 100)._def };
    const r = runValidation(schema, { score: 50 });
    expect(r.success).toBe(true);
  });
});

// ── NumberRule.exists() ───────────────────────────────────────────────────────

describe("NumberRule.exists() rule entry", () => {
  it("adds an exists rule entry to _def", () => {
    const rule = rules.number().exists("users", "id");
    const entry = rule._def.rules.find((r) => r.name === "exists");
    expect(entry).toBeDefined();
    expect(entry!.args[0]).toBe("users");
    expect(entry!.args[1]).toBe("id");
  });
});

// ── ArrayRule — min() / max() / size() ────────────────────────────────────────

describe("ArrayRule.min() / max() / size()", () => {
  it("min() rejects an array shorter than min", () => {
    const schema = { tags: rules.array(rules.string()).min(2)._def };
    const r = runValidation(schema, { tags: ["a"] });
    expect(r.success).toBe(false);
  });

  it("max() rejects an array longer than max", () => {
    const schema = { tags: rules.array(rules.string()).max(2)._def };
    const r = runValidation(schema, { tags: ["a", "b", "c"] });
    expect(r.success).toBe(false);
  });

  it("size() rejects an array of wrong size", () => {
    const schema = { pair: rules.array(rules.string()).size(2)._def };
    const r = runValidation(schema, { pair: ["a", "b", "c"] });
    expect(r.success).toBe(false);
  });
});

// ── ObjectRule ────────────────────────────────────────────────────────────────

describe("ObjectRule", () => {
  it("validates a nested object shape", () => {
    const schema = {
      address: rules.object({ street: rules.string(), zip: rules.string() })._def,
    };
    const r = runValidation(schema, { address: { street: "1 Main St", zip: "1234" } });
    expect(r.success).toBe(true);
  });

  it("fails when a nested field is invalid", () => {
    const schema = {
      address: rules.object({ street: rules.string(), zip: rules.string() })._def,
    };
    const r = runValidation(schema, { address: { street: "", zip: "1234" } });
    expect(r.success).toBe(false);
  });
});

// ── PasswordRule.confirmed() ──────────────────────────────────────────────────

describe("PasswordRule.confirmed()", () => {
  it("fails when confirmation does not match", () => {
    const schema = { password: rules.password().confirmed()._def };
    const r = runValidation(schema, { password: "secret", password_confirmation: "other" });
    expect(r.success).toBe(false);
  });

  it("passes when confirmation matches", () => {
    const schema = { password: rules.password().confirmed()._def };
    const r = runValidation(schema, { password: "Secret1!", password_confirmation: "Secret1!" });
    expect(r.success).toBe(true);
  });
});

// ── dbRules — registerDbRuleRunner / runDbRule ───────────────────────────────

describe("dbRules", () => {
  it("runDbRule throws when no runner is registered", async () => {
    // `_runner` is a process-global; another suite (via DatabaseProvider) may have
    // registered one before this test runs. Reset it so the no-runner path is deterministic.
    _resetDbRuleRunner();
    let threw = false;
    try {
      await runDbRule("unique", "users", "email", "test@test.com", {});
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain("unique()");
    }
    expect(threw).toBe(true);
  });

  it("registerDbRuleRunner + runDbRule: passes when runner returns true", async () => {
    registerDbRuleRunner(async () => true);
    const result = await runDbRule("unique", "users", "email", "test@test.com", {});
    expect(result).toBeUndefined();
  });

  it("runDbRule unique: returns default error when runner returns false", async () => {
    registerDbRuleRunner(async () => false);
    const result = await runDbRule("unique", "users", "email", "test@test.com", {});
    expect(result).toContain("already been taken");
  });

  it("runDbRule exists: returns default error when runner returns false", async () => {
    registerDbRuleRunner(async () => false);
    const result = await runDbRule("exists", "users", "id", 99, {});
    expect(result).toContain("invalid");
  });

  it("runDbRule: returns custom message when runner returns false", async () => {
    registerDbRuleRunner(async () => false);
    const result = await runDbRule("unique", "users", "email", "x@x.com", {}, "Email taken");
    expect(result).toBe("Email taken");
  });
});

// ── FormRequest.macro() / base rules() ───────────────────────────────────────

describe("FormRequest — macro() and base rules()", () => {
  // FormRequest is abstract but declares no abstract members: the base `rules()`
  // exists and throws. A bare subclass is what an app writes before it overrides
  // anything, so it is also what these two tests need.
  class BareRequest extends FormRequest {}

  it("macro() attaches a method to FormRequest.prototype", () => {
    FormRequest.macro("testHelper", function () {
      return 42;
    });
    const inst = new BareRequest();
    expect((inst as any).testHelper()).toBe(42);
  });

  it("base rules() throws not-implemented", () => {
    const inst = new BareRequest();
    expect(() => inst.rules({} as any)).toThrow("not implemented");
  });
});

// ── validate() HTTP helper ────────────────────────────────────────────────────

import { validate } from "./validate.ts";

function makeCtx(opts: {
  method?: string;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
  url?: string;
  session?: { set: (k: string, v: unknown) => void; forget: (k: string) => void };
}) {
  const method = opts.method ?? "POST";
  const url = opts.url ?? "http://localhost/test";
  const contentType = opts.contentType ?? "application/json";
  const body = opts.body ?? "{}";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    ...opts.headers,
  };

  const request = new Request(url, {
    method,
    headers,
    body: method !== "GET" ? body : undefined,
  });

  const ctx = {
    request,
    url: new URL(url),
    response: undefined as Response | undefined,
    session: opts.session,
  };
  return ctx as unknown as import("@zerotal/core").HttpContext;
}

describe("validate() — success paths", () => {
  it("returns validated data from JSON body", async () => {
    const ctx = makeCtx({ body: JSON.stringify({ name: "Alice" }) });
    const data = await validate(ctx, (r) => ({ name: r.string() }));
    expect((data as unknown as { name: string }).name).toBe("Alice");
  });

  it("returns validated data from form-urlencoded body", async () => {
    const ctx = makeCtx({
      contentType: "application/x-www-form-urlencoded",
      body: "name=Bob",
    });
    const data = await validate(ctx, (r) => ({ name: r.string() }));
    expect((data as unknown as { name: string }).name).toBe("Bob");
  });

  it("reads query params for GET requests", async () => {
    const ctx = makeCtx({
      method: "GET",
      url: "http://localhost/search?q=reno",
      body: undefined as unknown as string,
      contentType: "",
    });
    const data = await validate(ctx, (r) => ({ q: r.string() }));
    expect((data as unknown as { q: string }).q).toBe("reno");
  });

  it("clears session errors on success", async () => {
    const forgotten: string[] = [];
    const ctx = makeCtx({
      body: JSON.stringify({ email: "a@a.com" }),
      session: {
        set: () => {},
        forget: (k: string) => forgotten.push(k),
      },
    });
    await validate(ctx, (r) => ({ email: r.string() }));
    expect(forgotten).toContain("errors");
    expect(forgotten).toContain("old");
  });
});

describe("validate() — failure paths", () => {
  it("throws ValidationRedirectError for form submission failures", async () => {
    const ctx = makeCtx({
      body: "{}",
      headers: { Referer: "/form" },
    });
    await expect(validate(ctx, (r) => ({ name: r.string() }))).rejects.toBeInstanceOf(
      ValidationRedirectError,
    );
  });

  it("throws ValidationJsonError for JSON API failures", async () => {
    const ctx = makeCtx({
      body: "{}",
      headers: { Accept: "application/json" },
    });
    await expect(validate(ctx, (r) => ({ name: r.string() }))).rejects.toBeInstanceOf(
      ValidationJsonError,
    );
  });

  it("stores errors in session on failure", async () => {
    const stored: Record<string, unknown> = {};
    const ctx = makeCtx({
      body: "{}",
      session: {
        set: (k: string, v: unknown) => {
          stored[k] = v;
        },
        forget: () => {},
      },
    });
    try {
      await validate(ctx, (r) => ({ name: r.string() }));
    } catch {
      /* expected to throw — we assert the stored errors below */
    }
    expect(stored["errors"]).toBeDefined();
  });

  it("throws ValidationRedirectError for Inertia requests (not JSON error)", async () => {
    const ctx = makeCtx({
      body: "{}",
      headers: { "X-Inertia": "true", Accept: "application/json" },
    });
    await expect(validate(ctx, (r) => ({ name: r.string() }))).rejects.toBeInstanceOf(
      ValidationRedirectError,
    );
  });

  it("handles unreadable body gracefully (body = {})", async () => {
    const ctx = makeCtx({
      contentType: "application/json",
      body: "not valid json",
    });
    await expect(validate(ctx, (r) => ({ name: r.string() }))).rejects.toBeDefined(); // throws validation error — body treated as {}
  });

  it("reads multipart/form-data body fields", async () => {
    const formData = new FormData();
    formData.append("title", "hello");
    const req = new Request("http://localhost/upload", {
      method: "POST",
      body: formData,
    });
    const ctx = {
      request: req,
      url: new URL("http://localhost/upload"),
    } as unknown as import("@zerotal/core").HttpContext;
    const data = await validate(ctx, (r) => ({ title: r.string() }));
    expect((data as unknown as { title: string }).title).toBe("hello");
  });
});
