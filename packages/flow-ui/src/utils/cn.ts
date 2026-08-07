// ── cn() — class merge ──────────────────────────────────────────────────────
//
// The class-merging helper: clsx for conditional/array class composition, then
// tailwind-merge so a later Tailwind utility wins over an earlier conflicting one.
// This is what lets `<Button class="bg-red-500">` override the component's default
// `bg-primary` instead of both landing in the class list and fighting on specificity.
//
//   cn("px-4 py-2", isActive && "bg-primary", className)

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type { ClassValue };

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
