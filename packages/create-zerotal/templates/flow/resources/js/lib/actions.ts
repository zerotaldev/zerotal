import { toast } from "./toasts";

/**
 * Small things a button can ask for with a data attribute:
 *
 * - `data-copy="…"` copies the text to the clipboard (the recovery codes);
 * - `data-action="reload"` and `data-action="back"` — the error page's two buttons;
 * - `data-swap="<group>"` shows the next of the `[data-swap-panel="<group>"]` panels and
 *   hides the rest, disabling the inputs it hides so only the visible one is sent (the
 *   two-factor challenge's code / recovery code).
 */
export function installActions(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as Element;

    const copy = target.closest<HTMLElement>("[data-copy]");
    if (copy) {
      navigator.clipboard
        .writeText(copy.dataset["copy"] ?? "")
        .then(() => toast("success", copy.dataset["copied"] ?? "Copied."))
        .catch(() => toast("error", "Could not copy — select the text and copy it yourself."));
      return;
    }

    const action = target.closest<HTMLElement>("[data-action]")?.dataset["action"];
    if (action === "reload") window.location.reload();
    if (action === "back") window.history.back();

    const swap = target.closest<HTMLElement>("[data-swap]")?.dataset["swap"];
    if (swap) {
      const panels = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-swap-panel="${CSS.escape(swap)}"]`),
      );
      const current = panels.findIndex((panel) => !panel.hidden);
      const next = panels[(current + 1) % panels.length];
      for (const panel of panels) {
        const showing = panel === next;
        panel.hidden = !showing;
        for (const input of panel.querySelectorAll<HTMLInputElement>("input")) {
          input.disabled = !showing;
          if (!showing) input.value = "";
        }
        for (const error of panel.querySelectorAll<HTMLElement>("[data-error-for]"))
          error.hidden = true;
      }
      next?.querySelector<HTMLInputElement>("input")?.focus();
    }
  });
}
