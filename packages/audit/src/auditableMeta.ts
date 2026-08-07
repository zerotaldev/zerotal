// Shared derivation of a model's audit identity from an instance, so manual logs
// (`Audit.log(event, model, …)`) and the `Auditable` mixin agree on how a model
// maps to `auditable_type` / `auditable_id`.

/** The `auditable_type` for an instance — static `auditType` override or the class name. */
export function auditableTypeOf(model: object): string {
  const ctor = model.constructor as { auditType?: string; name: string };
  return ctor.auditType ?? ctor.name;
}

/** The `auditable_id` for an instance — its primary key, as a string. */
export function auditableIdOf(model: object): string {
  return String((model as { id?: unknown }).id ?? "");
}
