import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * A checkbox with its label. The whole label is the click target, and the box uses
 * the theme's primary colour through `accent-color`, so it stays a real checkbox.
 */
export function Checkbox({
  label,
  description,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  const controlId = rest.id ?? id;

  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        {...rest}
        id={controlId}
        type="checkbox"
        aria-describedby={description ? `${controlId}-description` : undefined}
        className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary"
      />
      <div className="text-sm leading-5">
        <label htmlFor={controlId} className="font-medium text-foreground">
          {label}
        </label>
        {description ? (
          <p id={`${controlId}-description`} className="text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
