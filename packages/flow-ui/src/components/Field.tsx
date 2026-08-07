/** @jsxImportSource @zerotal/flow */
// ── <Field> ─────────────────────────────────────────────────────────────────
//
// A labelled form control with its description and error message. The most
// repeated pattern in any app, and the one most often got subtly wrong by hand:
// a label that is not associated with its input, an error that screen readers
// never announce, a required marker that is decoration rather than information.
//
// Wrapping the control means the wiring happens once. The generated id links
// label to control, `aria-describedby` points at whichever of description and
// error is present, and `aria-invalid` follows the error — so the same markup
// that looks right also reads right.
//
//   <Field label="Email" description="We never share it." error={errors.email}>
//     <Input flow:model="form.email" type="email" />
//   </Field>

import { jsx } from "@zerotal/flow/jsx-runtime";
import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface FieldProps {
  label?: unknown;
  /** Helper text under the label, before the control. */
  description?: unknown;
  /** Validation message. Its presence is what marks the field invalid. */
  error?: unknown;
  /** Show the required marker and set `aria-required` on the control. */
  required?: boolean;
  /** Explicit id for the control. Generated when omitted. */
  id?: string;
  /** Lay the label beside the control instead of above it. */
  orientation?: "vertical" | "horizontal";
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

let counter = 0;
/** A stable-enough id for one render. Server-rendered, so per-process is plenty. */
function fieldId(): string {
  counter += 1;
  return `flow-field-${counter}`;
}

/**
 * Add the accessibility attributes to the control the caller passed.
 *
 * Children arrive already rendered — a Flow node is `{ html }` — so this
 * rewrites the first opening tag rather than setting props on an element. The
 * alternative is asking every caller to repeat `id`, `aria-describedby` and
 * `aria-invalid` on every input, which is precisely the duplication this
 * component exists to remove.
 *
 * Anything the caller already set is left alone: they know something we do not.
 */
export function wireControl(html: string, attrs: Record<string, string>): string {
  // The first opening tag, with its attributes. Quoted values are matched as a
  // unit so a `>` inside one does not end the tag early.
  const match = /<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)/.exec(html);
  if (!match) return html;

  const existing = match[2] ?? "";
  // Attribute names present on the tag already. Read by splitting rather than by
  // a built regex: an attribute name goes straight into the pattern, and one
  // containing a regex metacharacter would otherwise match the wrong thing.
  const present = new Set(
    existing
      .split(/\s+/)
      .map((part) => part.split("=")[0])
      .filter(Boolean),
  );

  const additions = Object.entries(attrs)
    .filter(([name]) => !present.has(name))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");

  if (!additions) return html;
  const at = match.index + match[0].length;
  return html.slice(0, at) + additions + html.slice(at);
}

export function Field(props: FieldProps): HtmlNode {
  const {
    label,
    description,
    error,
    required,
    id: idProp,
    orientation = "vertical",
    class: cls,
    children,
    ...rest
  } = props;

  const id = idProp ?? fieldId();
  const describedBy = [description ? `${id}-description` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  const attrs: Record<string, string> = {
    id,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": "true" } : {}),
    ...(required ? { "aria-required": "true" } : {}),
  };

  // Only the first control is wired: a field is one labelled control, and
  // pointing one label at several would be wrong rather than merely untidy.
  let wired = false;
  const controls = (Array.isArray(children) ? children : [children]).map((child) => {
    const node = child as { html?: string } | null;
    if (wired || !node || typeof node.html !== "string") return child;
    wired = true;
    return { html: wireControl(node.html, attrs) };
  });

  // A caller who set their own id wins, so the label must follow the control
  // rather than the other way round.
  const firstHtml = (controls.find((c) => (c as { html?: string })?.html) as { html?: string })
    ?.html;
  const controlId = /(^|\s)id="([^"]*)"/.exec(firstHtml ?? "")?.[2] ?? id;

  const horizontal = orientation === "horizontal";

  return jsx("div", {
    ...rest,
    class: cn(horizontal ? "flex items-start gap-4" : "space-y-1.5", cls),
    children: [
      label
        ? jsx("label", {
            for: controlId,
            class: cn(
              "block text-sm font-medium leading-none text-foreground",
              horizontal && "w-40 shrink-0 pt-2",
            ),
            children: [
              label,
              required
                ? jsx("span", {
                    // Marked for sighted readers and named for everyone else,
                    // since a bare asterisk means nothing to a screen reader.
                    class: "ml-0.5 text-destructive",
                    "aria-hidden": "true",
                    children: "*",
                  })
                : null,
            ],
          })
        : null,
      jsx("div", {
        class: cn(horizontal && "flex-1", "space-y-1.5"),
        children: [
          controls,
          description
            ? jsx("p", {
                id: `${id}-description`,
                class: "text-xs text-muted-foreground",
                children: description,
              })
            : null,
          error
            ? jsx("p", {
                id: `${id}-error`,
                // Announced when it appears, which is the point of an error.
                role: "alert",
                class: "text-xs font-medium text-destructive",
                children: error,
              })
            : null,
        ],
      }),
    ],
  });
}
