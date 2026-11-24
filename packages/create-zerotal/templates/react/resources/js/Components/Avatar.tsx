import { cn } from "../lib/cn";

/** Up to two initials from a name: "Ada Lovelace" → "AL", "ada" → "A". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

const SIZE = {
  sm: "size-7 text-[0.7rem]",
  md: "size-9 text-xs",
  lg: "size-12 text-base",
} as const;

/**
 * A user's initials in a circle. Decorative — the name is always written out next to
 * it — so it is hidden from screen readers. Swap in an `<img>` once users have photos.
 */
export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: keyof typeof SIZE | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-accent-foreground ring-1 ring-border",
        SIZE[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
