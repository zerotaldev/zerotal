/**
 * Minimal, dependency-free English inflector used by the convention layer to
 * derive table names and concern associations. Covers the common pluralisation
 * rules plus an irregular/uncountable table; cases beyond the table should be
 * handled with an explicit override (e.g. `@table("...")`).
 */

const IRREGULAR: Record<string, string> = {
  person: "people",
  man: "men",
  woman: "women",
  child: "children",
  tooth: "teeth",
  foot: "feet",
  mouse: "mice",
  goose: "geese",
  ox: "oxen",
  leaf: "leaves",
  life: "lives",
  knife: "knives",
  wife: "wives",
  half: "halves",
  loaf: "loaves",
  potato: "potatoes",
  tomato: "tomatoes",
  hero: "heroes",
  cactus: "cacti",
  focus: "foci",
  datum: "data",
  analysis: "analyses",
  index: "indices",
  matrix: "matrices",
  vertex: "vertices",
};

const IRREGULAR_INVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(IRREGULAR).map(([singular, plural]) => [plural, singular]),
);

// Words with no distinct plural form.
const UNCOUNTABLE = new Set([
  "equipment",
  "information",
  "rice",
  "money",
  "species",
  "series",
  "fish",
  "sheep",
  "deer",
  "aircraft",
  "news",
  "data",
  "media",
]);

/** Mirror the source word's leading capital onto an irregular-table result, so
 *  Title Case inputs (admin labels: `Person` → `People`) survive inflection.
 *  Table-name derivation feeds lowercase and is unaffected. */
function matchCase(source: string, result: string): string {
  return /^[A-Z]/.test(source) ? result.charAt(0).toUpperCase() + result.slice(1) : result;
}

/** Pluralize a single word (English, best-effort). */
function pluralizeWord(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();
  if (UNCOUNTABLE.has(lower)) return word;
  if (IRREGULAR[lower]) return matchCase(word, IRREGULAR[lower]!);
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/.test(word)) return word + "es";
  return word + "s";
}

/** Singularize a single word (English, best-effort). */
function singularizeWord(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();
  if (UNCOUNTABLE.has(lower)) return word;
  if (IRREGULAR_INVERSE[lower]) return matchCase(word, IRREGULAR_INVERSE[lower]!);
  if (/[^aeiou]ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Pluralize a snake_case or single word, inflecting only the final segment.
 * `"blog_post"` → `"blog_posts"`, `"category"` → `"categories"`, `"person"` → `"people"`.
 */
export function pluralize(value: string): string {
  const parts = value.split("_");
  parts[parts.length - 1] = pluralizeWord(parts[parts.length - 1] ?? "");
  return parts.join("_");
}

/** Singularize a snake_case or single word, inflecting only the final segment. */
export function singularize(value: string): string {
  const parts = value.split("_");
  parts[parts.length - 1] = singularizeWord(parts[parts.length - 1] ?? "");
  return parts.join("_");
}

/** `BlogPost` → `blog_post`, `userEmail` → `user_email`. */
export function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

/** `blog_post` / `blog-post` → `blogPost`. */
export function camelCase(value: string): string {
  return value
    .replace(/[_-]+(.)?/g, (_, char: string | undefined) => (char ? char.toUpperCase() : ""))
    .replace(/^(.)/, (_, char: string) => char.toLowerCase());
}

/** Convention table name for a model class name: snake_case + pluralized. `User` → `users`. */
export function tableNameFor(className: string): string {
  return pluralize(snakeCase(className));
}
