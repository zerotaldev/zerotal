/**
 * A button that shows and hides another element: `data-disclosure="<id>"`. It keeps
 * `aria-expanded` true to what is on screen, swaps its label between `data-label-open`
 * and `data-label-closed`, and shows whichever of its `[data-when-open]` /
 * `[data-when-closed]` children matches. The public site's phone menu uses it.
 */
export function installDisclosures(): void {
  document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-disclosure]");
    const panel = button ? document.getElementById(button.dataset["disclosure"] ?? "") : null;
    if (!button || !panel) return;

    const opening = panel.hidden;
    panel.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
    const label = opening ? button.dataset["labelOpen"] : button.dataset["labelClosed"];
    if (label) button.setAttribute("aria-label", label);
    for (const part of button.querySelectorAll<HTMLElement>("[data-when-open]"))
      part.hidden = !opening;
    for (const part of button.querySelectorAll<HTMLElement>("[data-when-closed]"))
      part.hidden = opening;
  });
}
