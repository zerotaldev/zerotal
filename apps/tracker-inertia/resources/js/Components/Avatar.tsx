import { cn } from "../lib/cn";

/**
 * Initials in a circle.
 *
 * No image: this app has no avatar upload, and a placeholder silhouette for
 * everyone says less than two letters do. Derived from the name rather than
 * stored, so it cannot fall out of step with it.
 *
 * The circle is `aria-hidden` — it repeats the name that is almost always
 * rendered beside it, and a screen reader announcing "L S Levi Santos" is worse
 * than one that just says the name. Where it stands alone, the surrounding
 * control carries the label.
 */

const SIZES = {
  sm: "size-6 text-[0.625rem]",
  md: "size-8 text-xs",
  lg: "size-9 text-xs",
} as const;

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export default function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground select-none",
        SIZES[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
