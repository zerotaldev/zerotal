import type { ReactNode } from "react";

/**
 * Four different nothings, and they are not interchangeable.
 *
 * "No issues yet" invites you to create one. "No issues match this filter"
 * invites you to clear it. Rendering the same sentence for both is the commonest
 * way a list stops explaining itself, so the caller has to say which it is.
 */
export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        aria-hidden="true"
        className="mb-4 flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground"
      >
        <span className="block size-2.5 rounded-full bg-current opacity-40" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
