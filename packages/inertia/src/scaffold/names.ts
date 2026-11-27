/**
 * The names one resource goes by: in URLs, route names, page names, variables and prose.
 */
import { pluralize, singularize } from "@zerotal/core";

/**
 * Every name a generated resource uses, derived once so the routes, the pages and the test
 * cannot disagree.
 *
 * @internal
 */
export interface _ResourceNames {
  /** The model class, e.g. `BlogPost`. */
  model: string;
  /** One record as a variable and a route parameter, e.g. `blogPost`. */
  record: string;
  /** Several, e.g. `blogPosts`. */
  records: string;
  /** The URL segment, the pages' directory and the route-name prefix, e.g. `blog-posts`. */
  segment: string;
  /** In a sentence, e.g. `blog post`. */
  singular: string;
  /** In a sentence, e.g. `blog posts`. */
  plural: string;
  /** As a title, e.g. `Blog posts`. */
  title: string;
  /**
   * The resource's own name in the singular, for the files that belong to it rather than to the
   * model, e.g. `BlogPost` (`BlogPostForm`). `make:resource Boards --model Project` is `Board`,
   * so its form does not collide with a `ProjectForm` already there.
   */
  component: string;
}

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-\s]+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

function camel(parts: string[]): string {
  return parts.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
}

/**
 * The names for a resource called `name` over `model`: `make:resource Task --model Task` is
 * `/tasks`, and `make:resource Chores --model Task` is `/chores` over the same model.
 *
 * @internal
 */
export function _resourceNames(name: string, model: string): _ResourceNames {
  const own = words(name.replace(/Resource$/, "") || model);
  const last = own.pop() ?? "item";
  // A name already in the plural (`Chores`) is kept as it is: `chores`, not `choreses`.
  const plural = [...own, pluralize(singularize(last)) === last ? last : pluralize(last)];
  const singularWords = words(model);
  const singularLast = singularWords.pop() ?? "item";
  const singular = [...singularWords, singularLast];
  const record = camel(singular);
  return {
    model,
    record,
    records: camel([...singularWords, pluralize(singularLast)]),
    segment: plural.join("-"),
    singular: singular.join(" "),
    plural: plural.join(" "),
    title: plural.join(" ").charAt(0).toUpperCase() + plural.join(" ").slice(1),
    component: [...own, singularize(last)]
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(""),
  };
}
