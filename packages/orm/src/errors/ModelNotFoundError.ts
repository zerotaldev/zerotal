import { ZerotalError } from "@zerotal/core";

/**
 * Thrown when a query that requires a result finds none — e.g. `findOrFail()`,
 * `firstOrFail()`, or implicit route-model binding. Carries an HTTP 404 status.
 *
 * @param model - The model name for the message.
 * @param id - The looked-up id, when the failure was a by-id lookup.
 */
export class ModelNotFoundError extends ZerotalError {
  constructor(model: string, id?: number | string) {
    super(
      id === undefined
        ? `No ${model} record found for the given query`
        : `No ${model} record found for ID: ${String(id)}`,
      "E_MODEL_NOT_FOUND",
      404,
      id === undefined ? { model } : { model, id },
    );
  }
}
