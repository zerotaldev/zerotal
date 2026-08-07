/**
 * Build a Flow {@link Form} subclass from a resource's form schema for a given
 * mode. The form's own enumerable properties are the visible field keys (so
 * `flow:model="form.<key>"` binds + survives WebSocket round-trips), and its
 * `rules()` are derived from the fields' validators.
 *
 * Accepts the full schema (`FormComponent[]` — fields and/or sections); the
 * sections are flattened to fields for the generated form. The page renders the
 * layout; the form only holds state + validation.
 *
 * One class is generated per (resource, mode) at boot and reused; a stable class
 * name lets the Form synth reconstruct it on hydration.
 */
import { Form } from "@zerotal/flow";
import type { RuleBuilder, FieldRule } from "@zerotal/validator";
import type { Field, FieldMode } from "./Field.ts";
import { type FormComponent, flattenFields } from "./Section.ts";

export type ResourceFormClass = new () => Form & Record<string, unknown>;

export function makeResourceForm(
  schema: FormComponent[],
  mode: FieldMode,
  className: string,
): { FormClass: ResourceFormClass; fields: Field[] } {
  const visible = flattenFields(schema).filter((f) => f.visibleIn(mode));
  const defaults: Record<string, unknown> = {};
  for (const f of visible) defaults[f._key] = f.defaultValue();

  class ResourceForm extends Form {
    constructor() {
      super();
      Object.assign(this, structuredClone(defaults));
    }

    override rules(v: RuleBuilder): Record<string, FieldRule> {
      const out: Record<string, FieldRule> = {};
      for (const f of visible) out[f._key] = f.buildRule(v);
      return out;
    }
  }

  Object.defineProperty(ResourceForm, "name", { value: className });
  // Instantiate once so the Form registry knows this class for hydration.
  new ResourceForm();

  return { FormClass: ResourceForm as unknown as ResourceFormClass, fields: visible };
}
