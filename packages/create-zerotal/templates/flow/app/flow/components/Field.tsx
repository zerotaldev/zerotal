import type { HtmlNode } from "@zerotal/flow";
import { Input, Textarea } from "./Input";
import { Select, type SelectOption } from "./Select";
import { FIELD, FIELD_ERROR, FIELD_HINT, FIELD_LABEL_ROW, LABEL } from "../lib/ui";

/**
 * Labelled form controls with error and hint text wired up.
 *
 * The point of these is the accessibility plumbing you would otherwise retype on every
 * form: the label is bound to the control by id, the error and hint are announced via
 * `aria-describedby`, and a failed field is marked `aria-invalid` rather than only
 * turning red. Pass `error={this.error("email")}` from the page.
 *
 * The error line is always in the markup, empty and hidden until it has something to
 * say, so the browser script can fill it in place when a form is sent without a page
 * load (resources/js/lib/forms.ts finds it by `data-error-for`).
 */

interface FieldProps {
  label: string;
  /** The form field's name — what the server reads it as. Also the control's id, unless one is given. */
  name: string;
  id?: string | undefined;
  error?: string | undefined;
  hint?: unknown;
  /** Shown to the right of the label — a "Forgot password?" link, say. */
  aside?: unknown;
  [attribute: string]: unknown;
}

function ids(name: string, id: string | undefined) {
  const controlId = id ?? `field-${name}`;
  return { controlId, errorId: `${controlId}-error`, hintId: `${controlId}-hint` };
}

/** The attributes that tie a control to its error or hint. */
function described(error: string | undefined, hint: unknown, errorId: string, hintId: string) {
  return {
    "aria-invalid": error ? "true" : undefined,
    "aria-describedby": error ? errorId : hint ? hintId : undefined,
  };
}

function Shell({
  label,
  name,
  error,
  hint,
  aside,
  controlId,
  errorId,
  hintId,
  children,
}: {
  label: string;
  name: string;
  error: string | undefined;
  hint: unknown;
  aside: unknown;
  controlId: string;
  errorId: string;
  hintId: string;
  children: unknown;
}): HtmlNode {
  return (
    <div class={FIELD}>
      <div class={FIELD_LABEL_ROW}>
        <label for={controlId} class={LABEL}>
          {label}
        </label>
        {aside}
      </div>

      {children}

      <p id={errorId} data-error-for={name} class={FIELD_ERROR} hidden={!error}>
        {error ?? ""}
      </p>
      {hint ? (
        <p id={hintId} data-hint-for={name} class={FIELD_HINT} hidden={Boolean(error)}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({ label, name, id, error, hint, aside, ...rest }: FieldProps): HtmlNode {
  const { controlId, errorId, hintId } = ids(name, id);
  return (
    <Shell {...{ label, name, error, hint, aside, controlId, errorId, hintId }}>
      <Input {...rest} id={controlId} name={name} {...described(error, hint, errorId, hintId)} />
    </Shell>
  );
}

export function TextAreaField({
  label,
  name,
  id,
  error,
  hint,
  aside,
  ...rest
}: FieldProps): HtmlNode {
  const { controlId, errorId, hintId } = ids(name, id);
  return (
    <Shell {...{ label, name, error, hint, aside, controlId, errorId, hintId }}>
      <Textarea {...rest} id={controlId} name={name} {...described(error, hint, errorId, hintId)} />
    </Shell>
  );
}

export function SelectField({
  label,
  name,
  id,
  error,
  hint,
  aside,
  options,
  ...rest
}: FieldProps & { options: readonly SelectOption[] }): HtmlNode {
  const { controlId, errorId, hintId } = ids(name, id);
  return (
    <Shell {...{ label, name, error, hint, aside, controlId, errorId, hintId }}>
      <Select
        {...rest}
        options={options}
        id={controlId}
        name={name}
        {...described(error, hint, errorId, hintId)}
      />
    </Shell>
  );
}
