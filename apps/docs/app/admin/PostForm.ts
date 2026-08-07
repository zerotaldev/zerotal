import { Form } from "@zerotal/flow";
import type { RuleBuilder } from "@zerotal/validator";
import { Str } from "zerotal";
import { POST_CATEGORIES } from "@app/models/Post.ts";

/**
 * The editable half of a post. A form object rather than fields on the page
 * because `title` is taken on `Component` (it sets the document title), and
 * because the same shape mounts on the editor and on anything else that writes
 * a post later.
 */
export class PostForm extends Form {
  title = "";
  slug = "";
  description = "";
  body = "";
  category: string = POST_CATEGORIES[0];

  rules(v: RuleBuilder) {
    return {
      title: v.string().min(1).max(160),
      category: v.string().in([...POST_CATEGORIES]),
      slug: v
        .string()
        .min(1)
        .max(160)
        .matches(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, numbers and hyphens only."),
      description: v.string().max(300).optional(),
      body: v.string().min(1),
    };
  }

  /** The slug this form would save under, derived from the title when left blank. */
  derivedSlug(): string {
    return this.slug || Str.slugify(this.title);
  }
}
