// ── gva() — flow variant authority ────────────────────────────────────────
//
// A tiny, dependency-free `class-variance-authority` clone for server-rendered
// Flow components. Build a class string from a `base` plus named `variants`
// (e.g. `variant`, `size`), `defaultVariants`, and `compoundVariants`. The
// returned function takes the chosen variant props (+ an optional `class`/
// `className` override) and returns the final merged class string.
//
//   const button = gva("inline-flex items-center rounded-md", {
//     variants: {
//       variant: { default: "bg-primary text-primary-foreground",
//                  outline: "border border-input bg-background" },
//       size:    { default: "h-9 px-4", sm: "h-8 px-3", lg: "h-10 px-6" },
//     },
//     compoundVariants: [{ variant: "outline", size: "sm", class: "px-2" }],
//     defaultVariants: { variant: "default", size: "default" },
//   });
//
//   button()                                   // base + default variant + default size
//   button({ variant: "outline", size: "sm" }) // base + outline + sm + compound
//   button({ class: "w-full" })                // appends an override (merged via cn)

import { cn } from "./cn.ts";
import type { ClassValue } from "./cn.ts";

// A map of variant-name → { option-value → classes }.
type VariantShape = Record<string, Record<string, ClassValue>>;

// The selectable props for a given variant shape: each variant key accepts one of
// its declared option names (e.g. variant?: "default" | "outline"). `| undefined`
// is explicit so callers can forward an optional prop straight through under
// exactOptionalPropertyTypes (e.g. `buttonVariants({ variant })`).
type VariantSelection<V extends VariantShape> = {
  [K in keyof V]?: keyof V[K] | undefined;
};

// A compound variant: a partial match over variant selections plus the classes to
// add when every listed variant matches the current selection.
type CompoundVariant<V extends VariantShape> = VariantSelection<V> & {
  class?: ClassValue;
  className?: ClassValue;
};

export interface GvaConfig<V extends VariantShape> {
  variants?: V;
  defaultVariants?: VariantSelection<V>;
  compoundVariants?: CompoundVariant<V>[];
}

// Props accepted by the returned function: the variant selection plus a free-form
// class override (`class` or `className`).
export type GvaProps<V extends VariantShape> = VariantSelection<V> & {
  class?: ClassValue;
  className?: ClassValue;
};

export function gva<V extends VariantShape>(base: ClassValue, config: GvaConfig<V> = {}) {
  const { variants, defaultVariants, compoundVariants } = config;

  return (props: GvaProps<V> = {}): string => {
    const { class: cls, className, ...selection } = props as Record<string, unknown>;

    const picked: ClassValue[] = [base];

    if (variants) {
      for (const variantKey of Object.keys(variants)) {
        const options = variants[variantKey]!;
        // Chosen value, falling back to the declared default for this variant.
        const chosen =
          (selection[variantKey] as string | undefined) ??
          (defaultVariants?.[variantKey] as string | undefined);
        if (chosen != null && chosen in options) picked.push(options[chosen]!);
      }
    }

    if (compoundVariants) {
      for (const compound of compoundVariants) {
        const {
          class: cClass,
          className: cClassName,
          ...conditions
        } = compound as Record<string, unknown>;
        const matches = Object.keys(conditions).every((key) => {
          const want = conditions[key];
          const actual =
            (selection[key] as string | undefined) ??
            (defaultVariants?.[key] as string | undefined);
          return actual === want;
        });
        if (matches) picked.push((cClass ?? cClassName) as ClassValue);
      }
    }

    // The caller's override goes last so tailwind-merge lets it win.
    picked.push((cls ?? className) as ClassValue);
    return cn(...picked);
  };
}
