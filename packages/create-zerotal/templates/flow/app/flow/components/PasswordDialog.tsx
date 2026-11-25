import type { HtmlNode } from "@zerotal/flow";
import type { ButtonVariant } from "../lib/button";
import { Button } from "./Button";
import { TextField } from "./Field";
import { Modal } from "./Modal";

/**
 * A dialog that asks for the password before doing something that cannot be taken back
 * — deleting the account, signing out every other device. The password goes to the
 * server with the request, and a wrong one comes back as a field error here, with the
 * dialog still open.
 *
 * Opened by a button with `data-open-modal` set to the same `id`.
 */
export function PasswordDialog({
  id,
  title,
  description,
  action,
  method,
  url,
  confirmLabel,
  variant = "danger",
}: {
  id: string;
  title: unknown;
  description?: unknown;
  /** Describes the button while the request is in flight. */
  action: string;
  method: "post" | "delete";
  url: string;
  confirmLabel: string;
  variant?: ButtonVariant | undefined;
}): HtmlNode {
  return (
    <Modal id={id} title={title} description={description}>
      <form
        method="post"
        action={url}
        data-method={method === "post" ? undefined : method}
        class="space-y-5"
      >
        <TextField
          label="Password"
          name="password"
          id={`${id}-password`}
          type="password"
          autocomplete="current-password"
          autofocus
          required
        />
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" data-close-modal="">
            Cancel
          </Button>
          <Button type="submit" variant={variant} data-loading-text={action}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
