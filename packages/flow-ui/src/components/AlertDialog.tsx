/** @jsxImportSource @zerotal/flow */
// ── <AlertDialog> ───────────────────────────────────────────────────────────
//
// A dialog that interrupts to ask before something irreversible happens.
//
// Different from <Dialog> in the ways that matter for a decision rather than a
// task: it cannot be dismissed by clicking the backdrop or pressing Escape, and
// it always ends in an explicit choice. That is deliberate — a delete confirmed
// by a stray click outside is not a confirmation.
//
// It also names the consequence rather than the action. "This deletes 3 orders
// and cannot be undone" tells someone what they are about to do; "Are you sure?"
// asks them to guess.
//
//   <AlertDialog
//     show={this.confirming}
//     title="Delete this product?"
//     description="It will be removed from every order. This cannot be undone."
//     confirmLabel="Delete"
//     onConfirm={this.destroy}
//     onCancel={() => (this.confirming = false)}
//   />

import type { HtmlNode } from "@zerotal/flow";
import { Dialog } from "./Dialog.tsx";
import { Button } from "./Button.tsx";

export interface AlertDialogProps {
  /** Bound @expose boolean controlling visibility. */
  show?: unknown;
  name?: string;
  title?: unknown;
  /** What will happen. Worth a full sentence. */
  description?: unknown;
  confirmLabel?: unknown;
  cancelLabel?: unknown;
  /** Server action run when the choice is made. */
  onConfirm?: unknown;
  onCancel?: unknown;
  /** Style the confirm button as destructive. Defaults to true. */
  destructive?: boolean;
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function AlertDialog(props: AlertDialogProps): HtmlNode {
  const {
    show,
    name,
    title,
    description,
    confirmLabel = "Continue",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
    destructive = true,
    class: cls,
    children,
    ...rest
  } = props;

  return (
    <Dialog
      show={show}
      {...(name ? { name } : {})}
      {...(title ? { title } : {})}
      {...(description ? { description } : {})}
      // No × and no dismiss-on-backdrop: the only ways out are the two buttons.
      closable={false}
      role="alertdialog"
      {...(cls ? { class: cls } : {})}
      {...(onCancel ? { onClose: onCancel } : {})}
      {...rest}
    >
      {children}
      <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" {...(onCancel ? { onClick: onCancel } : {})}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          {...(onConfirm ? { onClick: onConfirm } : {})}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
