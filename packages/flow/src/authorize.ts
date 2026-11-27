// Per-action authorization: `@can(...)` rules, then the component's `beforeAction()` hook, run
// before every exposed method the browser calls.
//
// `@can` checks a policy ability through the app's Gate. `@zerotal/flow` does not depend on
// `@zerotal/auth`: the gate is found in the container under `gate`, where AuthProvider binds it,
// and used through the one method this needs.
import { tryCurrentApp } from "@zerotal/core";
import type { ContainerBindings } from "@zerotal/core";
import type { Component } from "./Component.ts";
import { getCanRules } from "./decorators.ts";

/** The part of the Gate this uses. */
interface GateLike {
  allowsAsync(ability: string, model?: object): Promise<boolean>;
}

/** `gate` is a binding `@zerotal/auth` declares, so this package names it as a plain string. */
const GATE_TOKEN: string = "gate";

async function _gate(): Promise<GateLike> {
  const container = tryCurrentApp()?.container;
  const token = GATE_TOKEN as keyof ContainerBindings;
  const gate: unknown =
    container && container.bound(token) ? await container.make<unknown>(token) : undefined;
  if (
    gate === null ||
    typeof gate !== "object" ||
    typeof Reflect.get(gate, "allowsAsync") !== "function"
  ) {
    throw new Error(
      "[Flow] @can needs the app's Gate, and none is bound. Register AuthProvider " +
        "from @zerotal/auth, or check the ability in beforeAction() instead.",
    );
  }
  return gate as GateLike;
}

/**
 * Why the browser may not call `method` on `page` now, or `null` when it may.
 *
 * Runs every `@can` rule on the method, in the order written, then `beforeAction()`. A rule that
 * denies, a `beforeAction()` that returns `false`, and anything either throws all refuse.
 *
 * @internal
 */
export async function _actionRefusal(
  page: Component,
  method: string,
  args: unknown[],
): Promise<{ why: string; error?: string } | null> {
  try {
    const rules = getCanRules(page.constructor as { prototype: object }).get(method) ?? [];
    for (const rule of rules) {
      const model = rule.model?.(page, args) ?? undefined;
      if (!(await (await _gate()).allowsAsync(rule.ability, model))) {
        return { why: `the policy denies "${rule.ability}" for ${method}` };
      }
    }
    if ((await page.beforeAction(method, args)) === false) {
      return { why: `beforeAction() refused ${method}` };
    }
    return null;
  } catch (error) {
    return {
      why: `authorizing ${method} threw`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
