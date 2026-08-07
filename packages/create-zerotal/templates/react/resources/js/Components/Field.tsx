import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Labelled form controls with error and hint text wired up.
 *
 * The point of these is the accessibility plumbing you would otherwise retype on
 * every form: the label is bound to the control by id, the error and hint are
 * announced via `aria-describedby`, and a failed field is marked `aria-invalid`
 * rather than only turning red. Pass `error={errors.email}` straight from
 * Inertia's shared `errors` prop.
 */

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

const CONTROL =
  "w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground shadow-sm " +
  "transition-colors placeholder:text-muted-foreground focus:outline-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Shell({
  label,
  error,
  hint,
  controlId,
  errorId,
  hintId,
  children,
}: FieldProps & {
  controlId: string;
  errorId: string;
  hintId: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={controlId} className="block text-sm font-medium text-foreground">
        {label}
      </label>

      {children}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  error,
  hint,
  className,
  ...rest
}: FieldProps & ComponentProps<"input">) {
  const id = useId();
  const controlId = rest.id ?? `${id}-control`;

  return (
    <Shell
      label={label}
      error={error}
      hint={hint}
      controlId={controlId}
      errorId={`${id}-error`}
      hintId={`${id}-hint`}
    >
      <input
        {...rest}
        id={controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, error ? "border-destructive" : "border-input", className)}
      />
    </Shell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  className,
  rows = 5,
  ...rest
}: FieldProps & ComponentProps<"textarea">) {
  const id = useId();
  const controlId = rest.id ?? `${id}-control`;

  return (
    <Shell
      label={label}
      error={error}
      hint={hint}
      controlId={controlId}
      errorId={`${id}-error`}
      hintId={`${id}-hint`}
    >
      <textarea
        {...rest}
        id={controlId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(
          CONTROL,
          "resize-y",
          error ? "border-destructive" : "border-input",
          className,
        )}
      />
    </Shell>
  );
}
