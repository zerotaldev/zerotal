import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Labelled form controls with error and hint text wired up.
 *
 * The point of these is the accessibility plumbing you would otherwise retype on
 * every form: the label is bound to the control by id, the error and hint are
 * announced via `aria-describedby`, and a failed field is marked `aria-invalid`
 * and given a message — never only a red border, which says nothing to a screen
 * reader and little to anyone who cannot separate the two hues. Pass
 * `error={errors.email}` straight from Inertia's shared `errors` prop.
 *
 * Every control in the app comes from this file, so a filter select on the issue
 * list and an email box on the sign-in form are the same object at the same
 * height.
 */

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

/* The focus treatment is a ring rather than the global outline, and the control
 * opts out of that outline so the two never draw at once.
 *
 * Width is deliberately absent: `cn` is a plain join rather than a class-aware
 * merge, so baking `w-full` in here would leave any caller that wanted a
 * different width emitting both and depending on Tailwind's output order to
 * settle it. The labelled fields below add `w-full`; the toolbar controls size
 * themselves. */
const CONTROL =
  "rounded-md border bg-card px-3 text-sm text-foreground " +
  "transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground " +
  "focus:border-ring focus:ring-2 focus:ring-ring/15 focus:outline-none focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

/** The labelled fields all span their column. */
const FIELD_CONTROL = `w-full ${CONTROL}`;

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
        <p id={hintId} className="text-xs text-muted-foreground">
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
        className={cn(
          FIELD_CONTROL,
          "h-10",
          error ? "border-destructive" : "border-input",
          className,
        )}
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
          FIELD_CONTROL,
          "resize-y py-2",
          error ? "border-destructive" : "border-input",
          className,
        )}
      />
    </Shell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  className,
  children,
  ...rest
}: FieldProps & ComponentProps<"select">) {
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
      <select
        {...rest}
        id={controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(
          FIELD_CONTROL,
          "h-10",
          error ? "border-destructive" : "border-input",
          className,
        )}
      >
        {children}
      </select>
    </Shell>
  );
}

/**
 * The bare control class, for the places that need an input without a label
 * block — the issue list's filter bar, where the label is the surrounding
 * `aria-label` and the row is a toolbar rather than a form.
 */
export const controlClass = (className?: string): string =>
  cn(CONTROL, "h-9 border-input", className);
