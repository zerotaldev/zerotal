import {
  StringRule,
  NumberRule,
  BooleanRule,
  ArrayRule,
  ObjectRule,
  DateRule,
  FileRule,
  PasswordRule,
} from "./FieldRule.ts";
import type { FieldRule } from "./FieldRule.ts";
import type { Schema } from "./types.ts";

export class RuleBuilder {
  /**
   * A required value — shorthand for a required string, the most common entry point. Chain
   * the usual string constraints onto it: `rule.required().min(2).max(50)`,
   * `rule.required().email()`, `rule.required().min(8).confirmed()`. For other types start
   * from the typed builder instead (`rule.number()`, `rule.boolean()`, …), which are also
   * required by default.
   */
  required(message?: string): StringRule {
    return this.string().required(message);
  }
  string(): StringRule {
    return new StringRule();
  }
  number(): NumberRule {
    return new NumberRule();
  }
  boolean(): BooleanRule {
    return new BooleanRule();
  }
  date(): DateRule {
    return new DateRule();
  }
  /** Validates a File object from multipart/form-data. */
  file(): FileRule {
    return new FileRule();
  }
  /** Validates password strength — chain min/mixedCase/numbers/symbols. */
  password(): PasswordRule {
    return new PasswordRule();
  }

  email(message?: string): StringRule {
    return this.string().email(message);
  }

  url(message?: string): StringRule {
    return this.string().url(message);
  }

  uuid(message?: string): StringRule {
    return this.string().uuid(message);
  }

  array<T extends FieldRule>(item: T): ArrayRule<T> {
    return new ArrayRule(item);
  }

  object<S extends Schema>(shape: { [K in keyof S]: FieldRule }): ObjectRule<S> {
    return new ObjectRule<S>(shape);
  }
}
