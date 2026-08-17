import { FormRequest } from "zerotal/validator";
import type { RuleBuilder } from "zerotal/validator";
import { ISSUE_STATUSES } from "@app/models/Issue.ts";

/**
 * One column's new contents, after a drag.
 *
 * The client sends the **destination column in full** rather than a delta, which
 * is what makes the endpoint idempotent: replaying it lands on the same board,
 * and there is no fractional-position arithmetic to drift. The source column
 * needs no message — removing a card from it leaves the remaining positions
 * valid, because they are sparse.
 *
 * Deliberately **no return type** on `rules()`. The base class infers the schema
 * from it, and annotating it widens `validate()` to `Record<string, unknown>`.
 */
export class ReorderBoardRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      status: r.string().in([...ISSUE_STATUSES]),
      issueIds: r.array(r.number()).max(500),
    };
  }
}
