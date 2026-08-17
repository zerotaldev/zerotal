import { FormRequest } from "zerotal/validator";
import type { RuleBuilder } from "zerotal/validator";

/** Extensions the tracker accepts. Screenshots and the odd log or PDF. */
export const ATTACHMENT_MIMES = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "log"];

/** Kilobytes. Matches the message the form shows before anyone tries. */
export const ATTACHMENT_MAX_KB = 8 * 1024;

/**
 * The rules for attaching a file.
 *
 * Deliberately **no return type** on `rules()`. The base class infers the schema
 * from it, and annotating it — as `bun zt make:request` does — widens
 * `validate()` to `Record<string, unknown>` and every field becomes `unknown`.
 *
 * The size limit is expressed once, here, and imported by the page so the hint
 * the reader is shown cannot drift from the rule that rejects them.
 */
export class StoreAttachmentRequest extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      file: r.file().mimes(ATTACHMENT_MIMES).max(ATTACHMENT_MAX_KB),
    };
  }
}
