// ── cn() — class merge ──────────────────────────────────────────────────────
//
// The class-merging helper: `classList` flattens conditional/array/object class
// input, then tailwind-merge makes a later Tailwind utility win over an earlier
// conflicting one. This is what lets `<Button class="bg-red-500">` override the
// component's default `bg-primary` instead of both landing in the class list and
// fighting on specificity.
//
//   cn("px-4 py-2", isActive && "bg-primary", className)
//
// tailwind-merge is flow-ui's one runtime dependency: it carries a model of every
// Tailwind class group, which is not something to keep in-house. The flattening is
// twenty lines, so it lives here.

import { twMerge } from "tailwind-merge";

/** Anything `cn()` accepts: strings, numbers, nested arrays, `{ class: condition }` maps, falsy values. */
export type ClassValue =
  ClassArray | ClassDictionary | string | number | bigint | null | boolean | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- `any` lets interfaces without an index signature through
export type ClassDictionary = Record<string, any>;
export type ClassArray = ClassValue[];

function toClass(value: ClassValue): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  let out = "";
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const part = value[i] ? toClass(value[i]) : "";
      if (part) out += out ? ` ${part}` : part;
    }
  } else {
    // `for…in` on purpose: inherited enumerable keys count, as they did under clsx.
    for (const key in value) if (value[key]) out += out ? ` ${key}` : key;
  }
  return out;
}

/**
 * Flatten class input to one space-separated string, dropping falsy values (`false`,
 * `null`, `undefined`, `0`, `""`) and object keys whose value is falsy. No merging.
 */
export function classList(...inputs: ClassValue[]): string {
  return toClass(inputs);
}

export function cn(...inputs: ClassValue[]): string {
  return twMerge(classList(inputs));
}
