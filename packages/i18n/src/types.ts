/** A translation catalog — nested objects and/or flat dotted keys, leaves are strings. */
export type Messages = { [key: string]: string | Messages };

/** locale → messages */
export type Catalogs = Record<string, Messages>;

/** Interpolation values; `count` additionally drives pluralization. */
export type Replacements = Record<string, string | number>;

/** Built-in request locale resolvers, applied in order. */
export type LocaleResolver = "query" | "cookie" | "accept-header";
