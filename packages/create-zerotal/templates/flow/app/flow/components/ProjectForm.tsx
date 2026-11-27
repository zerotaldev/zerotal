import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { buttonClass } from "../lib/button";
import { STATUS_OPTIONS } from "../lib/projects";
import {
  CARD,
  CARD_BODY,
  CARD_FOOTER,
  FIELD,
  FIELD_ERROR,
  FIELD_HINT,
  FIELD_LABEL_ROW,
  INPUT,
  LABEL,
  SELECT,
  SELECT_CHEVRON,
  TEXTAREA,
  icon,
} from "../lib/ui";

/** What the form shows in its fields. */
export interface ProjectFormValues {
  name: string;
  description: string;
  status: string;
}

/** A field's message from a failed save, if it failed. */
export interface ProjectFormErrors {
  name?: string | undefined;
  description?: string | undefined;
  status?: string | undefined;
}

export interface ProjectFormProps {
  /** Where the form posts. */
  action: string;
  /** Sent as `_method` by resources/js/lib/forms.ts: "put" for an update. */
  method?: string | undefined;
  values: ProjectFormValues;
  errors: ProjectFormErrors;
  /** The submit button's label. */
  submit: string;
}

/**
 * The project form, used by projects/create.tsx and projects/edit.tsx.
 *
 * The error line under each field is always in the markup, empty and hidden until it has
 * something to say, so the browser script can fill it in place when the form is sent without a
 * page load (resources/js/lib/forms.ts finds it by `data-error-for`).
 *
 * Flow compiles this into the pages that render it, as long as it stays one function of its
 * props that returns markup: no `this`, no event handlers, no spread props.
 */
export function ProjectForm({
  action,
  method,
  values,
  errors,
  submit,
}: ProjectFormProps): HtmlNode {
  return (
    <div class={CARD}>
      <form method="post" action={action} data-method={method}>
        <div class={`${CARD_BODY} space-y-5`}>
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-name" class={LABEL}>
                Name
              </label>
            </div>
            <input
              class={INPUT}
              autofocus
              value={values.name}
              required
              id="field-name"
              name="name"
              aria-invalid={errors.name ? "true" : undefined}
              aria-describedby={errors.name ? "field-name-error" : undefined}
            />
            <p
              id="field-name-error"
              data-error-for="name"
              class={FIELD_ERROR}
              hidden={!errors.name}
            >
              {errors.name}
            </p>
          </div>
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-description" class={LABEL}>
                Description
              </label>
            </div>
            <textarea
              class={TEXTAREA}
              rows="4"
              id="field-description"
              name="description"
              aria-invalid={errors.description ? "true" : undefined}
              aria-describedby={
                errors.description ? "field-description-error" : "field-description-hint"
              }
            >
              {values.description}
            </textarea>
            <p
              id="field-description-error"
              data-error-for="description"
              class={FIELD_ERROR}
              hidden={!errors.description}
            >
              {errors.description}
            </p>
            <p
              id="field-description-hint"
              data-hint-for="description"
              class={FIELD_HINT}
              hidden={Boolean(errors.description)}
            >
              Optional. What it is, and what done looks like.
            </p>
          </div>
          <div class={FIELD}>
            <div class={FIELD_LABEL_ROW}>
              <label for="field-status" class={LABEL}>
                Status
              </label>
            </div>
            <div class="relative">
              <select
                class={SELECT}
                id="field-status"
                name="status"
                aria-invalid={errors.status ? "true" : undefined}
                aria-describedby={errors.status ? "field-status-error" : undefined}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option value={option.value} selected={option.value === values.status}>
                    {option.label}
                  </option>
                ))}
              </select>
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                class={SELECT_CHEVRON}
                dangerouslySetInnerHTML={icon("chevron-down")}
              />
            </div>
            <p
              id="field-status-error"
              data-error-for="status"
              class={FIELD_ERROR}
              hidden={!errors.status}
            >
              {errors.status}
            </p>
          </div>
        </div>
        <div class={CARD_FOOTER}>
          <a
            href={route("projects")}
            class="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </a>
          <button type="submit" class={buttonClass("primary", "md")} data-loading-text="Saving…">
            {submit}
          </button>
        </div>
      </form>
    </div>
  );
}
