import { FormRequest } from "zerotal/validator";
import type { RuleBuilder } from "zerotal/validator";
import { PROJECT_STATUSES } from "@app/models/Project";

/**
 * What a project form must contain — shared by create and edit, so the two cannot
 * disagree. `await ProjectRequest.validate()` returns the typed fields, or sends the
 * visitor back to the form with the errors and what they typed.
 */
export class ProjectRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      name: r.string().trim().min(2).max(120),
      description: r.string().trim().max(2000).optional(),
      // `in()` checks the value; the route narrows it to `ProjectStatus` when it saves.
      status: r.string().in([...PROJECT_STATUSES]),
    };
  }
}
