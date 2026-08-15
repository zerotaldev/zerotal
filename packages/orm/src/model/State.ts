// ── State machine mixin ───────────────────────────────────────────────────────
//
// Finite-state-machine behaviour as an opt-in mixin, so only models that declare a
// workflow carry the API — `transitionTo` / `forceState` / `onTransition` / the
// `states` + `stateField` statics never appear on models that don't use them.
//
//   import { Model, State } from "@zerotal/orm";
//
//   const States = {
//     pending: { canTransitionTo: ["active", "cancelled"] as const },
//     active:  { canTransitionTo: ["expired"] as const,
//                guard: (s: Subscription) => { if (!s.stripeId) throw new StateError(...); } },
//     expired: { canTransitionTo: [] as const },
//     cancelled: { canTransitionTo: [] as const },
//   } as const;
//
//   class Subscription extends Model.using(State) {
//     static states = States;
//     @column() status!: keyof typeof States;
//   }

import { isProdLike, deployEnv } from "@zerotal/core";
import { StateError } from "../errors/index.ts";
import { currentOrmContext } from "./OrmContext.ts";
import type { Constructor } from "./mixins.ts";
import type { ClassRef } from "../support/classRef.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Reject the in-flight transition with a human-readable reason. Throws a {@link StateError}
 * pre-populated with the model name and the from/to states, so a guard doesn't have to
 * construct the error itself:
 *
 *   guard: async (order, reject) => {
 *     if (!order.paid) reject("Can't ship an unpaid order.");
 *   }
 */
export type RejectTransition = (reason: string) => never;

/** Context a guard receives alongside the model: the reject helper and the from/to states. */
export interface TransitionContext {
  /** Reject the transition with a reason — throws a StateError carrying the model + from/to. */
  reject: RejectTransition;
  /** The state being transitioned **from**. */
  current: string;
  /** The state being transitioned **to**. */
  intended: string;
}

/**
 * A guard that runs before a transition is committed. It may:
 *  - allow it (return `true`/`undefined`),
 *  - block it (return `false` — yields a generic StateError), or
 *  - reject it with a reason via `ctx.reject(reason)` (a StateError carrying that reason).
 */
export type StateGuard<T> = (
  model: T,
  ctx: TransitionContext,
) => boolean | void | Promise<boolean | void>;

/**
 * Result of {@link State.transitionTo}: `[true]` on success, or `[false, StateError]` when the
 * transition is illegal or a guard blocks it. Destructure and check — TypeScript narrows the
 * error to `StateError` in the `!ok` branch:
 *
 *   const [ok, err] = await order.transitionTo("shipped");
 *   if (!ok) return json({ error: err.message }, 422);
 */
export type TransitionResult = [ok: true] | [ok: false, error: StateError];

/** One state's definition within a state machine. */
export interface StateDefinition<States extends string, T = unknown> {
  canTransitionTo: readonly States[];
  guard?: StateGuard<T>;
}

/** Full state schema — a plain object with `as const`. */
export type StateMachine<States extends string, T = unknown> = {
  [K in States]: StateDefinition<States, T>;
};

/** Callback fired after a successful transition (from → to). */
export type TransitionCallback<T> = (
  model: T,
  meta: { from: string; to: string },
) => Promise<void> | void;

// ── Callback registry (execution-scoped on the OrmContext) ────────────────────

/** @internal Register or retrieve transition callbacks for a model class. */
function _getCallbacks(ModelClass: ClassRef, state: string): TransitionCallback<unknown>[] {
  const reg = currentOrmContext().transitionCallbacks;
  if (!reg.has(ModelClass)) reg.set(ModelClass, new Map());
  const map = reg.get(ModelClass)!;
  if (!map.has(state)) map.set(state, []);
  return map.get(state)! as TransitionCallback<unknown>[];
}

/** @internal Clear all transition callbacks — used in tests. Prefer resetOrmContext(). */
export function _clearTransitionCallbacks(): void {
  currentOrmContext().transitionCallbacks.clear();
}

// ── The mixin ─────────────────────────────────────────────────────────────────

interface StateModelClass {
  // `any` (not `unknown`) for the model type so a subclass can type its guards with its own
  // concrete model — `guard: (order: Order, reject) => …` — without a variance conflict.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  states?: Record<string, StateDefinition<string, any>>;
  stateField: string;
  name: string;
}

/**
 * Mixin that adds finite-state-machine behaviour to a model. Compose it so only
 * models that declare a workflow carry the API — `transitionTo` / `forceState` /
 * `onTransition` and the `states` + `stateField` statics never appear on models
 * that don't use them.
 *
 * Declare the machine in `static states` (use `as const` for exact state typing)
 * and, optionally, override `static stateField` when the state column isn't
 * `status`. Each transition validates that the move is allowed, runs the target
 * state's guard, persists via `save()`, then fires `onTransition` callbacks.
 *
 * @example
 * ```ts
 * const States = {
 *   pending:   { canTransitionTo: ["active", "cancelled"] as const },
 *   active:    { canTransitionTo: ["expired"] as const,
 *                guard: (s: Subscription) => { if (!s.stripeId) throw new StateError(...); } },
 *   expired:   { canTransitionTo: [] as const },
 *   cancelled: { canTransitionTo: [] as const },
 * } as const;
 *
 * class Subscription extends Model.using(State) {
 *   static states = States;
 *   @column() status!: keyof typeof States;
 * }
 *
 * const [ok, err] = await sub.transitionTo("active");
 * if (!ok) return json({ error: err.message }, 422);
 * ```
 */
export function State<TBase extends Constructor>(Base: TBase) {
  class State extends Base {
    /** Column name that holds the state value. Override when it isn't `status`. */
    static stateField = "status";

    /**
     * Finite-state-machine definition. Each key is a valid state; `canTransitionTo`
     * lists the states reachable from it, and an optional `guard` runs before the
     * target is entered (call `reject(reason)`, throw `StateError`, or return `false`
     * to block). Use `as const` so TypeScript infers the exact state union.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see StateModelClass note
    static states?: Record<string, StateDefinition<string, any>>;

    /**
     * Register a callback that fires after a successful `transitionTo()`. Pass `'*'`
     * to listen on every transition.
     *
     * @example
     * Subscription.onTransition("active", async (sub, { from }) => { ... });
     * Subscription.onTransition("*", (sub, { from, to }) => { ... });
     */
    static onTransition<T>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this: { new (...args: any[]): T },
      toState: string,
      callback: TransitionCallback<T>,
    ): void {
      _getCallbacks(this as unknown as ClassRef, toState).push(
        callback as TransitionCallback<unknown>,
      );
    }

    /**
     * Transition the model to a new state, enforcing the rules in `static states`:
     * validates the transition is allowed, runs the target state's guard, updates
     * the state column and `save()`s, then fires `onTransition` callbacks.
     *
     * Returns a result tuple — `[true]` on success, or `[false, StateError]` when the
     * transition is illegal or a guard blocks it — so callers can branch without a
     * try/catch. Unexpected errors (a failing `save()`, a throwing `onTransition`
     * callback, or a non-StateError thrown by a guard) still propagate.
     *
     * @example
     * const [ok, err] = await ticket.transitionTo("resolved");
     * if (!ok) return json({ error: err.message }, 422);
     */
    async transitionTo(newState: string): Promise<TransitionResult> {
      const ModelClass = this.constructor as unknown as StateModelClass;
      const schema = ModelClass.states;
      const self = this as unknown as Record<string, unknown>;
      const field = ModelClass.stateField;
      const currentState = String(self[field] ?? "");
      const modelName = ModelClass.name;

      if (!schema) {
        return [
          false,
          new StateError(
            modelName,
            currentState,
            newState,
            `State machine not configured on ${modelName}. Add \`static states = { ... }\`.`,
          ),
        ];
      }

      const currentDef = schema[currentState];
      if (!currentDef) {
        return [
          false,
          new StateError(
            modelName,
            currentState,
            newState,
            `Unknown current state '${currentState}' on ${modelName}.`,
          ),
        ];
      }

      if (!(currentDef.canTransitionTo as readonly string[]).includes(newState)) {
        return [false, new StateError(modelName, currentState, newState)];
      }

      // Run the target state's guard before touching the DB. A guard blocks the transition by
      // returning `false` or calling `ctx.reject(reason)` (which throws a StateError we catch
      // and surface in the tuple). Any *other* thrown error is a real fault and propagates.
      const targetDef = schema[newState];
      if (targetDef?.guard) {
        const reject: RejectTransition = (reason: string): never => {
          throw new StateError(modelName, currentState, newState, reason);
        };
        try {
          const allowed = await (targetDef.guard as StateGuard<this>)(this, {
            reject,
            current: currentState,
            intended: newState,
          });
          if (allowed === false) {
            return [
              false,
              new StateError(
                modelName,
                currentState,
                newState,
                `Guard rejected transition from '${currentState}' to '${newState}' on ${modelName}.`,
              ),
            ];
          }
        } catch (error) {
          if (error instanceof StateError) return [false, error];
          throw error;
        }
      }

      self[field] = newState;
      await (this as unknown as { save(): Promise<unknown> }).save();

      // Fire registered transition callbacks.
      const map = currentOrmContext().transitionCallbacks.get(this.constructor as ClassRef);
      const meta = { from: currentState, to: newState };
      const toFns = (map?.get(newState) ?? []) as TransitionCallback<unknown>[];
      const anyFns = (map?.get("*") ?? []) as TransitionCallback<unknown>[];
      for (const fn of [...toFns, ...anyFns]) await fn(this as unknown, meta);

      return [true];
    }

    /**
     * Forcefully set the state column to any value, bypassing guards and
     * `onTransition` callbacks. For **test factories** and **seeders** only —
     * throws when `APP_ENV` is `production`.
     *
     * @throws {Error} when called with `APP_ENV=production`.
     */
    async forceState(state: string): Promise<this> {
      if (isProdLike(deployEnv())) {
        throw new Error("forceState() cannot be called in production (APP_ENV=production).");
      }
      const field = (this.constructor as unknown as StateModelClass).stateField;
      (this as unknown as Record<string, unknown>)[field] = state;
      return (this as unknown as { save(): Promise<unknown> }).save() as Promise<this>;
    }
  }

  return State;
}
