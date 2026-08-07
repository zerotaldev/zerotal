import { ZerotalError } from "@zerotal/core";

/**
 * Thrown when a relation is accessed on a model that was not eager-loaded with
 * `.with('relation')`, guarding against accidental lazy loads / N+1 queries.
 *
 * @param relation - The relation name that was accessed.
 * @param model - The model the relation was accessed on.
 */
export class RelationNotLoadedError extends ZerotalError {
  constructor(relation: string, model: string) {
    super(
      `Relation "${relation}" was accessed on ${model} without eager loading. Use .with('${relation}') in your query.`,
      "E_RELATION_NOT_LOADED",
      500,
      { relation, model },
    );
  }
}
