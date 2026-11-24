import type { FormEvent, ReactNode } from "react";
import { useForm } from "@inertiajs/react";
import { Button, type ButtonVariant } from "./Button";
import { TextField } from "./Field";
import { Modal } from "./Modal";

/**
 * A dialog that asks for the password before doing something that cannot be taken
 * back — deleting the account, signing out every other device. The password goes to
 * the server with the request, and a wrong one comes back as a field error here.
 */
export function PasswordDialog({
  open,
  onClose,
  title,
  description,
  action,
  method,
  url,
  confirmLabel,
  variant = "danger",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Describes the button while the request is in flight. */
  action: string;
  method: "post" | "delete";
  url: string;
  confirmLabel: string;
  variant?: ButtonVariant | undefined;
}) {
  const form = useForm({ password: "" });

  function close() {
    form.reset();
    form.clearErrors();
    onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    form.submit(method, url, {
      preserveScroll: true,
      onSuccess: () => close(),
      onFinish: () => form.reset(),
    });
  }

  return (
    <Modal open={open} onClose={close} title={title} description={description}>
      <form onSubmit={submit} className="space-y-5">
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={form.data.password}
          error={form.errors.password}
          onChange={(e) => form.setData("password", e.target.value)}
          required
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant={variant} disabled={form.processing}>
            {form.processing ? action : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
