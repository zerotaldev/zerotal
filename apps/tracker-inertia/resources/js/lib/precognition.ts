import { useCallback, useRef, useState } from "react";

/**
 * Validate one field against the server's real rules, without saving anything.
 *
 * A `Precognition: true` header makes `FormRequest.validate()` run the rules and
 * then stop — 204 when the input is clean, 422 with the errors when it is not —
 * before the handler's body executes. So this posts to the *same endpoint the
 * form submits to*, and the record is not created. There is no second route to
 * keep in step and no copy of the rules in the browser: the thing answering is
 * `StoreIssueRequest`, the same object the real POST validates against and the
 * same one the other two cookbook builds share.
 *
 * `Precognition-Validate-Only` narrows the reply to the field the reader just
 * left. Without it, blurring the title would return an error for every other
 * field they have not reached yet, and a form that turns red ahead of you is
 * worse than one that waits.
 *
 * Errors live here rather than in `useForm`'s bag, because Inertia owns that one
 * and repopulates it on every visit — writing into it would fight the router.
 * The form merges the two when it renders a field.
 */
export function usePrecognition(url: string, method: string) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validating, setValidating] = useState<string | null>(null);
  // One request at a time per form: a reader tabbing quickly through fields
  // would otherwise race two replies, and the slower one wins by arriving last.
  const inflight = useRef<AbortController | null>(null);

  const clear = useCallback((field: string) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const validate = useCallback(
    async (field: string, data: Record<string, unknown>) => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      setValidating(field);

      try {
        const res = await fetch(url, {
          method,
          credentials: "same-origin",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Precognition: "true",
            "Precognition-Validate-Only": field,
          },
          body: JSON.stringify(data),
        });

        if (res.status === 204) {
          clear(field);
          return;
        }
        if (res.status === 422) {
          // `ValidationErrors` is `Record<string, string>` — one message per
          // field, not an array of them. Indexing `[0]` here reads the first
          // *character*, so the field would have shown a helpful "T". Tolerating
          // both shapes because the array form is the common convention and a
          // future change to it should not silently reduce every message to a
          // letter again.
          const body = (await res.json()) as {
            errors?: Record<string, string | string[]>;
          };
          const raw = body.errors?.[field];
          const message = Array.isArray(raw) ? raw[0] : raw;
          if (message) setErrors((prev) => ({ ...prev, [field]: message }));
          else clear(field);
          return;
        }
        // Any other status is this feature failing, not the input being wrong.
        // Saying nothing leaves the reader with the submit-time error, which is
        // the behaviour they had before live validation existed.
        clear(field);
      } catch {
        // Aborted by the next keystroke, or offline. Neither is the reader's
        // fault and neither is a validation result, so nothing is shown.
      } finally {
        setValidating((current) => (current === field ? null : current));
      }
    },
    [url, method, clear],
  );

  return { errors, validating, validate, clear };
}
