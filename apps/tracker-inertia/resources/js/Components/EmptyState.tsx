import type { ReactNode } from "react";

/**
 * Four different nothings, and they are not interchangeable.
 *
 * "No issues yet" invites you to create one. "No issues match this filter"
 * invites you to clear it. Rendering the same sentence for both is the commonest
 * way a list stops explaining itself, so the caller has to say which it is — and
 * supplies the way out, if there is one.
 *
 * `icon` is optional and decorative. It is drawn inside an `aria-hidden` frame,
 * because the heading beneath it already says what the reader is looking at.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div
        aria-hidden="true"
        className="mb-4 grid size-10 place-items-center rounded-full border border-border bg-muted text-muted-foreground"
      >
        {icon ?? <span className="block size-2 rounded-full bg-current opacity-40" />}
      </div>

      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
