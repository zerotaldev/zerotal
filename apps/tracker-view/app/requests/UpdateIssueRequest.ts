import { FormRequest } from "zerotal/validator";
import type { RuleBuilder } from "zerotal/validator";
import { Gate } from "zerotal/auth";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, type Issue } from "@app/models/Issue.ts";

/**
 * The rules for editing an issue — and who is allowed to.
 *
 * `authorize()` is why this is a class rather than a schema: features 4 and 5
 * are one object. It runs *before* the body is touched, so a request that is not
 * allowed to be here is refused because of who sent it, not told which of its
 * fields were wrong. Returning false throws `ForbiddenError`, which the handler
 * renders as a 403.
 *
 * It defers to `IssuePolicy`, the same policy the route and the page's Edit
 * button consult, so the three cannot disagree about who may edit.
 */
export class UpdateIssueRequest extends FormRequest {
  override authorize(): boolean {
    const issue = this.context.params.issue as unknown as Issue | undefined;
    return issue != null && Gate.allows("update", issue);
  }


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
      assigneeId: r.number().optional().nullable(),
    };
  }
}
