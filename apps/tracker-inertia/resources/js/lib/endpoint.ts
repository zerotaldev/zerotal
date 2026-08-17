import { action } from "zerotal/routes";
import type { RouteArgs, RouteTarget } from "zerotal/routes";

/** The verbs Inertia's `useForm().submit()` accepts. */
export type FormMethod = "get" | "post" | "put" | "patch" | "delete";

export interface Endpoint {
  url: string;
  method: FormMethod;
}

/**
 * A named route, resolved to the two things a submission needs.
 *
 * `action()` already returns `{ url, method }`; this narrows the verb to the
 * lowercase set Inertia expects, so no call site has to carry a cast. That cast
 * is the whole reason this exists — written once here it is a detail, written at
 * every form it is a rehearsal for getting it wrong.
 *
 * @example
 * const { url, method } = endpoint("projects.issues.comments.store", {
 *   project: slug,
 *   issue: id,
 * });
 * form.submit(method, url, { preserveScroll: true });
 */
export function endpoint<N extends RouteTarget>(name: N, ...args: RouteArgs<N>): Endpoint {
  const resolved = action(name, ...args);
  return { url: resolved.url, method: resolved.method.toLowerCase() as FormMethod };
}
