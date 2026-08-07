import { ZerotalError } from "@zerotal/core";

/**
 * Thrown when `fill()` / `create()` receives an attribute that the model's
 * mass-assignment rules do not allow.
 *
 * Zerotal guards by default: a model that declares neither `fillable` nor
 * `guarded` (and has not opted into `static unguarded = true`) rejects every
 * mass-assigned attribute, so a stray `role`/`is_admin`/`id` in a request body
 * can never reach the database. Declare `fillable` to allow specific columns,
 * or use `forceFill()` / `forceCreate()` for trusted, framework-internal writes.
 */
export class MassAssignmentError extends ZerotalError {
  constructor(model: string, attribute: string) {
    super(
      `[Zerotal ORM] "${attribute}" is not mass-assignable on ${model}. ` +
        `Add it to \`static fillable\`, or use forceFill()/forceCreate() for trusted data. ` +
        `Models guard all attributes by default — set \`static unguarded = true\` to opt out.`,
      "E_MASS_ASSIGNMENT",
      422,
      { model, attribute },
    );
    this.name = "MassAssignmentError";
  }
}
