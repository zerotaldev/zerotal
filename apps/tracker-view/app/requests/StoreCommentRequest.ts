import { FormRequest } from "zerotal/validator";
import type { RuleBuilder } from "zerotal/validator";

/**
 * The rules for posting a comment.
 *
 * Deliberately **no return type** on `rules()`. The base class infers the schema
 * from it, and annotating it — as `bun zt make:request` does — widens
 * `validate()` to `Record<string, unknown>` and every field becomes `unknown`.
 *
 * Shared byte-for-byte with the other two builds: the same empty comment must be
 * refused whether it arrives by form POST, socket action or Inertia visit.
 */
export class StoreCommentRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      body: r.string().trim().min(1).max(10_000),
    };
  }
}
