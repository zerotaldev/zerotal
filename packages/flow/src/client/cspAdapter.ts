// ── CSP evaluator adapter ──────────────────────────────────────────────────────
//
// Replaces Alpine's default (`new Function`) evaluator with our eval-free
// `evaluateCsp` interpreter, so EVERY Alpine expression (x-data="{}", x-text,
// :class, flow:click client expressions, …) runs under a strict CSP without
// `'unsafe-eval'`.
//
// ⚠️ BROWSER-VERIFICATION REQUIRED (CSP_PLAN.md · C5). The Alpine evaluator
// contract and `$data`/magic resolution below are implemented to Alpine 3's
// documented surface but MUST be confirmed against a real `unsafe-eval`-free CSP
// in a browser — that's the one piece unit tests can't cover. The pure evaluator
// (cspEvaluator.ts) is independently verified; this file is only the wiring.

import { evaluateCsp } from "./cspEvaluator.ts";
import { _resolveGel } from "./bridge.ts";

type AlpineLike = {
  setEvaluator(fn: (el: Element, expression: string | (() => unknown)) => unknown): void;
  $data?(el: Element): Record<string, unknown>;
  store?(name: string, init?: unknown): unknown;
};

type Receiver = (value: unknown) => void;
type EvalOpts = { scope?: Record<string, unknown>; params?: unknown[] };

export function installCspEvaluator(Alpine: AlpineLike): void {
  Alpine.setEvaluator((el, expression) => {
    // Alpine sometimes passes a function (handlers bound as functions) — already
    // CSP-safe (no string is compiled), so just call it.
    if (typeof expression === "function") {
      return (receiver: Receiver = () => {}, opts: EvalOpts = {}) =>
        receiver((expression as (...a: unknown[]) => unknown)(...(opts.params ?? [])));
    }

    const expr = expression;
    return (receiver: Receiver = () => {}, opts: EvalOpts = {}): void => {
      const data = (Alpine.$data ? Alpine.$data(el) : {}) as Record<string, unknown>;
      const extra = opts.scope ?? {};

      // Scope proxy: resolve Flow/Alpine magics we control, then x-for-style
      // call scope, then the element's reactive x-data. Reads/writes pass through
      // to the reactive `data` so dependency tracking and mutation still work.
      const scope = new Proxy({} as Record<string, unknown>, {
        get(_t, k: string | symbol): unknown {
          if (typeof k !== "string") return undefined;
          if (k === "$flow") return _resolveGel(el);
          if (k === "$el") return el;
          if (k === "$store") return Alpine.store;
          if (k in extra) return extra[k];
          return data[k];
        },
        set(_t, k: string | symbol, v: unknown): boolean {
          if (typeof k !== "string") return false;
          if (k in extra) {
            extra[k] = v;
            return true;
          }
          data[k] = v; // reactive write
          return true;
        },
        has(): boolean {
          return true;
        },
      });

      let result: unknown;
      try {
        result = evaluateCsp(expr, scope);
      } catch (e) {
        console.error("[Flow CSP] expression error:", e, "\nExpression:", expr);
        return;
      }
      if (typeof result === "function") {
        result = (result as (...a: unknown[]) => unknown)(...(opts.params ?? []));
      }
      receiver(result);
    };
  });
}
