import { ZerotalError } from "@zerotal/core";

/**
 * Thrown when `model.transitionTo()` is called with a state that is not
 * reachable from the model's current state, or when a target-state guard
 * rejects the transition.
 */
export class StateError extends ZerotalError {
  constructor(model: string, from: string, to: string, detail?: string) {
    super(
      detail ?? `Illegal transition on ${model}: cannot move from '${from}' to '${to}'.`,
      "E_INVALID_TRANSITION",
      422,
      { model, from, to },
    );
    this.name = "StateError";
  }
}
