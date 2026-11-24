import { useId, type ComponentProps, type ReactNode } from "react";
import { Input, Textarea } from "./Input";
import { Select, type SelectOption } from "./Select";

/**
 * Labelled form controls with error and hint text wired up.
 *
 * The point of these is the accessibility plumbing you would otherwise retype on
 * every form: the label is bound to the control by id, the error and hint are
 * announced via `aria-describedby`, and a failed field is marked `aria-invalid`
 * rather than only turning red. Pass `error={form.errors.email}` straight from
 * `useForm()`.
 */

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  /** Shown to the right of the label — a "Forgot password?" link, say. */
  aside?: ReactNode;
}

/** The ids a field's parts use, so the control can point at its error and hint. */
function useFieldIds(id: string | undefined) {
  const generated = useId();
  const controlId = id ?? `${generated}-control`;
  return { controlId, errorId: `${controlId}-error`, hintId: `${controlId}-hint` };
}

function described(error: string | undefined, hint: ReactNode, errorId: string, hintId: string) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : hint ? hintId : undefined,
  } as const;
}

function Shell({
  label,
  error,
  hint,
  aside,
  controlId,
  errorId,
  hintId,
  children,
}: FieldProps & { controlId: string; errorId: string; hintId: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={controlId} className="block text-sm font-medium text-foreground">
          {label}
        </label>
        {aside}
      </div>

      {children}

      {error ? (
        <p id={errorId} className="text-sm text-destructive">
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
  aside,
  ...rest
}: FieldProps & ComponentProps<"input">) {
  const ids = useFieldIds(rest.id);
  return (
    <Shell label={label} error={error} hint={hint} aside={aside} {...ids}>
      <Input {...rest} id={ids.controlId} {...described(error, hint, ids.errorId, ids.hintId)} />
    </Shell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  aside,
  ...rest
}: FieldProps & ComponentProps<"textarea">) {
  const ids = useFieldIds(rest.id);
  return (
    <Shell label={label} error={error} hint={hint} aside={aside} {...ids}>
      <Textarea {...rest} id={ids.controlId} {...described(error, hint, ids.errorId, ids.hintId)} />
    </Shell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  aside,
  ...rest
}: FieldProps & ComponentProps<"select"> & { options: readonly SelectOption[] }) {
  const ids = useFieldIds(rest.id);
  return (
    <Shell label={label} error={error} hint={hint} aside={aside} {...ids}>
      <Select {...rest} id={ids.controlId} {...described(error, hint, ids.errorId, ids.hintId)} />
    </Shell>
  );
}
