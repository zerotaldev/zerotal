/**
 * The dialogs components/Modal.tsx writes (and the signed-in shell's phone menu): a native
 * `<dialog data-modal>`, opened with `showModal()` so focus moves in and stays there, the
 * page behind goes inert and Escape closes it.
 *
 * A button with `data-open-modal="<id>"` opens one; anything inside with
 * `data-close-modal`, or a click on the backdrop, closes it. Closing clears a form's
 * field errors and password, so it opens clean next time.
 */
function openers(dialog: HTMLDialogElement): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>(`[data-open-modal="${CSS.escape(dialog.id)}"]`);
}

export function openModal(dialog: HTMLDialogElement): void {
  if (!dialog.open) dialog.showModal();
  for (const opener of openers(dialog)) opener.setAttribute("aria-expanded", "true");
}

function reset(dialog: HTMLDialogElement): void {
  for (const opener of openers(dialog)) opener.setAttribute("aria-expanded", "false");
  for (const input of dialog.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
    input.value = "";
  }
  for (const error of dialog.querySelectorAll<HTMLElement>("[data-error-for]")) {
    error.hidden = true;
    error.textContent = "";
  }
  for (const input of dialog.querySelectorAll("[aria-invalid]"))
    input.removeAttribute("aria-invalid");
}

export function installModals(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as Element;

    const opener = target.closest<HTMLElement>("[data-open-modal]");
    if (opener) {
      const dialog = document.getElementById(opener.dataset["openModal"] ?? "");
      if (dialog instanceof HTMLDialogElement) openModal(dialog);
      return;
    }

    // A click whose target is the dialog itself landed on the backdrop.
    if (target instanceof HTMLDialogElement && target.matches("[data-modal]")) {
      target.close();
      return;
    }

    if (target.closest("[data-close-modal]")) {
      target.closest<HTMLDialogElement>("dialog[data-modal]")?.close();
    }
  });

  // However it closed — Escape, a button, the backdrop, a submitted form.
  document.addEventListener(
    "close",
    (event) => {
      if (event.target instanceof HTMLDialogElement && event.target.matches("[data-modal]")) {
        reset(event.target);
      }
    },
    true,
  );
}
