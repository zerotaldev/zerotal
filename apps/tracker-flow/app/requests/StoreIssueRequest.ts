import { FormRequest } from "zerotal/validator";
import type { RuleBuilder } from "zerotal/validator";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";

/**
 * The rules for creating an issue.
 *
 * Deliberately **no return type** on `rules()`. The base class infers the schema
 * from it, and annotating it — as `bun zt make:request` does — widens
 * `validate()` to `Record<string, unknown>` and every field becomes `unknown`.
 *
 * Shared byte-for-byte with the other two builds. Three render layers, one set
 * of rules, which is the whole claim feature 4 makes.
 */
export class StoreIssueRequest extends FormRequest {

  /**
   * An unselected `<select>` posts `""`, and HTML has no way to say `null`.
   *
   * The Inertia build normalised this in the browser before posting, which meant
   * the rule below was only satisfiable from a build that runs JavaScript. Doing
   * it here makes `assigneeId` nullable for every transport — a plain form, a
   * fetch, or a JSON client — which is what "one set of rules" has to mean.
   */
  override prepareForValidation(body: Record<string, unknown>) {
    if (body["assigneeId"] === "") body["assigneeId"] = null;
    return body;
  }

  rules(r: RuleBuilder) {
    return {
      title: r.string().trim().min(3).max(140),
      body: r.string().trim().max(20_000).optional(),
      status: r.string().in([...ISSUE_STATUSES]),
      priority: r.string().in([...ISSUE_PRIORITIES]),
      // Nullable as well as optional: an unselected <select> sends "", which is
      // not a number, so the form normalises it to null before posting.
      assigneeId: r.number().optional().nullable(),
    };
  }
}
