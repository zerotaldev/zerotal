import { Link } from "@inertiajs/react";
import { APP_NAME } from "../lib/site";
import { cn } from "../lib/cn";

/**
 * The product mark — a violet tile and the name.
 *
 * One component, used by the sidebar, the sign-in screen and the public page's
 * header, because a product whose logo changes between its front door and its
 * dashboard reads as two products that happen to share a database.
 *
 * The tile is the app's only decorative use of the accent colour, which is what
 * keeps it feeling like a mark rather than another button.
 */
export default function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-[0.6875rem] font-bold text-primary-foreground"
      >
        {APP_NAME.charAt(0)}
      </span>
      <span className="truncate text-sm">{APP_NAME}</span>
    </Link>
  );
}
