import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../lib/cn";

/**
 * A checkbox with its label. The whole label is the click target, and the box uses the
 * theme's primary colour through `accent-color`, so it stays a real checkbox.
 */
export function Checkbox({
  label,
  name,
  id,
  description,
  class: className,
  ...rest
}: {
  label: unknown;
  name: string;
  id?: string | undefined;
  description?: unknown;
  class?: string | undefined;
  [attribute: string]: unknown;
}): HtmlNode {
  const controlId = id ?? `field-${name}`;
  return (
    <div class={cn("flex items-start gap-2.5", className)}>
      <input
        {...rest}
        id={controlId}
        name={name}
        type="checkbox"
        aria-describedby={description ? `${controlId}-description` : undefined}
        class="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
      />
      <div class="text-sm leading-5">
        <label for={controlId} class="font-medium text-foreground">
          {label}
        </label>
        {description ? (
          <p id={`${controlId}-description`} class="text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
