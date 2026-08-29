// A Form bundles related fields + their validation rules + reset/fill helpers into
// a reusable class, mounted on a component as a single @expose property:
//
//   class LoginForm extends Form {
//     email = '';
//     password = '';
//     rules(v: RuleBuilder) {
//       return { email: v.string().email(), password: v.string().min(8) };
//     }
//   }
//
//   class LoginPage extends Component {
//     @expose form = new LoginForm();
//     @expose async submit() {
//       this.validate(this.form);          // validates form.data() against form.rules
//       await Auth.attempt(this.form.data());
//     }
//   }
//
// Validation uses the built-in @zerotal/validator (its fluent RuleBuilder schema).
// Bind fields with `value={this.form.email}` (compiled to flow:model="form.email").
// Forms round-trip through a synthesizer so the class + methods survive hydration.

import { ValidationError } from "./validation.ts";
import { registerSynth } from "./synths/index.ts";
import { RuleBuilder, runValidation } from "@zerotal/validator";
import type { FieldRule, Schema } from "@zerotal/validator";

/** Registry of Form subclasses by name, used to reconstruct forms on hydration. */
const _formClasses = new Map<string, new () => Form>();

/**
 * Register a Form subclass so it can be rebuilt from a snapshot. Called automatically.
 *
 * @internal
 */
export function registerForm(FormClass: new () => Form): void {
  _formClasses.set(FormClass.name, FormClass);
}

const _RESERVED = new Set(["rules"]);

/**
 * A reusable bundle of related form fields, their validation rules, and fill/reset helpers,
 * mounted on a {@link Component} as a single `@expose` property.
 *
 * @remarks
 * Declare fields as plain instance properties and their validation in {@link rules} (built with
 * `@zerotal/validator`'s fluent {@link RuleBuilder}). Bind inputs with `value={this.form.email}`
 * (the compiler rewrites it to `flow:model="form.email"`). Validate either from the component
 * (`this.validate(this.form)`) or directly ({@link validate}); both share the same engine and
 * error shape. A Form round-trips through a synthesizer, so its class and methods survive
 * hydration — the subclass must be imported (instantiated at least once) on the server.
 *
 * @example
 * ```tsx
 * import { Component, expose, Form } from "@zerotal/flow";
 * import type { RuleBuilder } from "@zerotal/validator";
 *
 * class LoginForm extends Form {
 *   email = "";
 *   password = "";
 *   rules(v: RuleBuilder) {
 *     return { email: v.string().email(), password: v.string().min(8) };
 *   }
 * }
 *
 * class LoginPage extends Component {
 *   @expose form = new LoginForm();
 *
 *   @expose async submit() {
 *     this.validate(this.form);        // throws + re-renders with errors on failure
 *     await Auth.attempt(this.form.data());
 *   }
 *
 *   override async render() {
 *     return (
 *       <form data-flow-root flow:submit="submit">
 *         <input value={this.form.email} />
 *         <input type="password" value={this.form.password} />
 *         <button>Log in</button>
 *       </form>
 *     );
 *   }
 * }
 * ```
 */
export abstract class Form {
  /** Duck-type marker (avoids cross-module instanceof / import cycles). */
  readonly __isFlowForm = true as const;

  constructor() {
    // Auto-register so the synth can reconstruct this subclass on hydration.
    registerForm(this.constructor as new () => Form);
  }

  /**
   * Validation schema, built with the @zerotal/validator RuleBuilder. Override in
   * the subclass; fields are required by default.
   *
   * @example
   * rules(v: RuleBuilder) {
   *   return { email: v.string().email(), age: v.number().min(18).optional() };
   * }
   */

  rules(_v: RuleBuilder): Record<string, FieldRule> {
    return {};
  }

  /** The form's field values — own enumerable data props (excludes rules/methods/_*). */
  data(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this)) {
      if (_RESERVED.has(k) || k.startsWith("_") || typeof v === "function") continue;
      out[k] = v;
    }
    return out;
  }

  /** Assign matching fields from a plain object (unknown keys ignored). */
  fill(values: Record<string, unknown>): this {
    for (const [k, v] of Object.entries(values)) {
      if (_RESERVED.has(k) || k.startsWith("_")) continue;
      if (Object.prototype.hasOwnProperty.call(this, k)) {
        (this as Record<string, unknown>)[k] = v;
      }
    }
    return this;
  }

  /** Reset fields to their declared defaults — all of them, or just the named ones. */
  reset(...fields: string[]): this {
    const fresh = new (this.constructor as new () => this)();
    const keys = fields.length ? fields : Object.keys(this.data());
    for (const k of keys) {
      (this as Record<string, unknown>)[k] = (fresh as Record<string, unknown>)[k];
    }
    return this;
  }

  /**
   * @internal Run the @zerotal/validator schema against the current data, returning
   * a field → messages map (empty when valid). Used by `validate()` and by
   * `Component.validate(form)` so both share the same engine + error shape.
   */
  _validateToErrors(): Record<string, string[]> {
    const factory = this.rules(new RuleBuilder());
    const schema: Schema = {};
    for (const [field, rule] of Object.entries(factory)) schema[field] = rule._def;

    const result = runValidation(schema, this.data());
    if (result.success) return {};

    // Zerotal errors are one message per field; Flow's bag is field → messages[].
    const out: Record<string, string[]> = {};
    for (const [field, msg] of Object.entries(result.errors)) out[field] = [msg];
    return out;
  }

  /**
   * Validate the form against its {@link rules} (via `@zerotal/validator`).
   *
   * @returns the form's {@link data} on success.
   * @throws {ValidationError} on failure — the framework catches it and re-renders with errors.
   */
  validate(): Record<string, unknown> {
    const errors = this._validateToErrors();
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    return this.data();
  }
}

// Serialize a Form to its field values + class name; rebuild the right subclass on hydrate.
registerSynth({
  key: "form",
  match: (v): v is Form =>
    typeof v === "object" && v !== null && (v as { __isFlowForm?: unknown }).__isFlowForm === true,
  dehydrate(form: Form, meta) {
    meta["form"] = form.constructor.name;
    return form.data();
  },
  hydrate(data, meta) {
    const name = meta["form"] as string;
    const FormClass = _formClasses.get(name);
    if (!FormClass) {
      throw new Error(
        `[Flow] Unknown Form class "${name}". Ensure it is imported (instantiated at least once) on the server.`,
      );
    }
    return new FormClass().fill(data as Record<string, unknown>);
  },
});
