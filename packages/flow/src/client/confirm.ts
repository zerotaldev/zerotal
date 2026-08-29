// ── Styled confirmation dialog ──────────────────────────────────────────────
//
// Replaces the browser-native window.confirm()/prompt() with a Tailwind-Plus-style
// modal (centered panel, status icon, title + description, Confirm/Cancel buttons,
// optional "type-to-confirm" input). Built with INLINE styles on purpose: the
// dialog is created at runtime from the bridge, so an app's Tailwind `@source`
// never scans it and utility classes would be purged. Inline = self-contained and
// correct in every app, and it auto-adapts to dark mode like the toast.
//
// `confirmDialog(opts)` returns a Promise<boolean> — true on Confirm, false on
// Cancel / Escape / backdrop. For the prompt variant, Confirm is enabled only once
// the typed value matches `opts.prompt`.

export interface ConfirmDialogOptions {
  /** Body text (the description, or the heading when no `title` is given). */
  message: string;
  /** Bold heading above the message. */
  title?: string | undefined;
  /** Confirm button label (default: "Confirm", or "Delete" for danger). */
  confirmLabel?: string | undefined;
  /** Cancel button label (default: "Cancel"). */
  cancelLabel?: string | undefined;
  /** `danger` = destructive (red); `primary` = neutral/indigo (default). */
  variant?: "danger" | "primary" | undefined;
  /** Custom icon (emoji/text/SVG markup), or `false` to hide the icon entirely. */
  icon?: string | false | undefined;
  /** Show a type-to-confirm input; Confirm unlocks only when the value matches this. */
  prompt?: string | undefined;
}

const ICONS = {
  // Heroicons solid — exclamation-triangle (danger) / question-mark-circle (primary).
  danger:
    '<svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>',
  primary:
    '<svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.06-1.061 3.5 3.5 0 114.95 4.95l-1.757 1.757a.75.75 0 01-1.06-1.06l1.757-1.757a2 2 0 10-2.829-2.83zM10 14a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>',
};

interface Palette {
  bg: string;
  ring: string;
  title: string;
  body: string;
  // Status icon circle.
  iconBg: string;
  iconFg: string;
  // Confirm (primary) button.
  btnBg: string;
  btnBgHover: string;
  btnFg: string;
  // Cancel (secondary) button.
  cancelBg: string;
  cancelBgHover: string;
  cancelFg: string;
  cancelRing: string;
  // Type-to-confirm input.
  inputBg: string;
  inputRing: string;
  inputFg: string;
}

function palette(variant: "danger" | "primary"): Palette {
  const el = document.documentElement;
  const dark =
    el.classList.contains("dark") ||
    (!el.classList.contains("light") &&
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches);

  const accent =
    variant === "danger"
      ? { bg: "#dc2626", hover: "#b91c1c", tintLight: "#fee2e2", fgLight: "#dc2626" }
      : { bg: "#4f46e5", hover: "#4338ca", tintLight: "#e0e7ff", fgLight: "#4f46e5" };

  return dark
    ? {
        bg: "#1f2937",
        ring: "rgba(255,255,255,.1)",
        title: "#f9fafb",
        body: "#9ca3af",
        iconBg: variant === "danger" ? "rgba(220,38,38,.15)" : "rgba(99,102,241,.15)",
        iconFg: variant === "danger" ? "#f87171" : "#a5b4fc",
        btnBg: accent.bg,
        btnBgHover: accent.hover,
        btnFg: "#ffffff",
        cancelBg: "#374151",
        cancelBgHover: "#4b5563",
        cancelFg: "#e5e7eb",
        cancelRing: "rgba(255,255,255,.1)",
        inputBg: "#111827",
        inputRing: "#4b5563",
        inputFg: "#f9fafb",
      }
    : {
        bg: "#ffffff",
        ring: "rgba(0,0,0,.05)",
        title: "#111827",
        body: "#6b7280",
        iconBg: accent.tintLight,
        iconFg: accent.fgLight,
        btnBg: accent.bg,
        btnBgHover: accent.hover,
        btnFg: "#ffffff",
        cancelBg: "#ffffff",
        cancelBgHover: "#f9fafb",
        cancelFg: "#111827",
        cancelRing: "#d1d5db",
        inputBg: "#ffffff",
        inputRing: "#d1d5db",
        inputFg: "#111827",
      };
}

function esc(s: string): string {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

const FONT = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";

/**
 * Show a styled confirmation dialog. Resolves `true` if the user confirms,
 * `false` on cancel / Escape / backdrop click.
 */
export function confirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  const variant = opts.variant === "danger" ? "danger" : "primary";
  const c = palette(variant);
  const heading = opts.title ? opts.title : opts.message;
  const description = opts.title ? opts.message : "";
  const confirmLabel = opts.confirmLabel ?? (variant === "danger" ? "Delete" : "Confirm");
  const cancelLabel = opts.cancelLabel ?? "Cancel";
  const showIcon = opts.icon !== false;
  const iconHtml = showIcon
    ? typeof opts.icon === "string" && opts.icon
      ? opts.icon
      : ICONS[variant]
    : "";

  return new Promise<boolean>((resolve) => {
    const prevOverflow = document.body.style.overflow;
    const lastFocused = document.activeElement as HTMLElement | null;

    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:center;" +
      "padding:16px;font-family:" +
      FONT +
      ";";
    // Center on >= 640px, bottom-sheet on small screens (matches the Tailwind example).
    if (typeof matchMedia === "function" && matchMedia("(min-width: 640px)").matches) {
      overlay.style.alignItems = "center";
    }

    const backdrop = document.createElement("div");
    backdrop.style.cssText =
      "position:absolute;inset:0;background:rgba(17,24,39,.6);opacity:0;transition:opacity .2s ease;";

    const panel = document.createElement("div");
    panel.style.cssText =
      "position:relative;width:100%;max-width:32rem;background:" +
      c.bg +
      ";border-radius:14px;" +
      "box-shadow:0 20px 50px rgba(0,0,0,.25),0 0 0 1px " +
      c.ring +
      ";padding:24px;" +
      "opacity:0;transform:translateY(12px) scale(.98);transition:opacity .2s ease, transform .2s ease;";

    const inputId = "flow-confirm-input";
    panel.innerHTML =
      '<div style="display:flex;gap:16px;align-items:flex-start">' +
      (showIcon
        ? '<div style="flex-shrink:0;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9999px;background:' +
          c.iconBg +
          ";color:" +
          c.iconFg +
          '">' +
          iconHtml +
          "</div>"
        : "") +
      '<div style="flex:1;min-width:0;text-align:left">' +
      '<h2 style="margin:0;font:600 16px ' +
      FONT +
      ";color:" +
      c.title +
      '">' +
      esc(heading) +
      "</h2>" +
      (description
        ? '<p style="margin:6px 0 0;font:400 14px ' +
          FONT +
          ";color:" +
          c.body +
          ';line-height:1.55">' +
          esc(description) +
          "</p>"
        : "") +
      (opts.prompt
        ? '<input id="' +
          inputId +
          '" type="text" autocomplete="off" placeholder="' +
          esc(opts.prompt) +
          '" style="margin-top:14px;width:100%;box-sizing:border-box;padding:8px 12px;border-radius:8px;' +
          "font:400 14px " +
          FONT +
          ";background:" +
          c.inputBg +
          ";color:" +
          c.inputFg +
          ";border:0;box-shadow:0 0 0 1px " +
          c.inputRing +
          ' inset;outline:none" />'
        : "") +
      "</div></div>" +
      // Buttons: row-reverse on >= 640px (Confirm right), stacked on small screens.
      '<div data-flow-confirm-actions style="margin-top:24px;display:flex;gap:10px;flex-direction:column-reverse">' +
      '<button type="button" data-flow-cancel style="padding:9px 16px;border-radius:8px;border:0;cursor:pointer;' +
      "font:600 14px " +
      FONT +
      ";background:" +
      c.cancelBg +
      ";color:" +
      c.cancelFg +
      ";box-shadow:0 0 0 1px " +
      c.cancelRing +
      ' inset">' +
      esc(cancelLabel) +
      "</button>" +
      '<button type="button" data-flow-ok style="padding:9px 16px;border-radius:8px;border:0;cursor:pointer;' +
      "font:600 14px " +
      FONT +
      ";background:" +
      c.btnBg +
      ";color:" +
      c.btnFg +
      ";box-shadow:0 1px 2px rgba(0,0,0,.1)" +
      (opts.prompt ? ";opacity:.5;pointer-events:none" : "") +
      '">' +
      esc(confirmLabel) +
      "</button>" +
      "</div>";

    overlay.appendChild(backdrop);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    // On >= 640px, lay the buttons out as a right-aligned row (Confirm rightmost).
    const actions = panel.querySelector("[data-flow-confirm-actions]") as HTMLElement | null;
    if (actions && typeof matchMedia === "function" && matchMedia("(min-width: 640px)").matches) {
      actions.style.flexDirection = "row-reverse";
      actions.style.justifyContent = "flex-start";
    }

    const okBtn = panel.querySelector("[data-flow-ok]") as HTMLButtonElement;
    const cancelBtn = panel.querySelector("[data-flow-cancel]") as HTMLButtonElement;
    const input = panel.querySelector("#" + inputId) as HTMLInputElement | null;

    // Hover polish (inline styles can't carry :hover).
    const hover = (btn: HTMLElement, on: string, off: string) => {
      btn.addEventListener("mouseenter", () => (btn.style.background = on));
      btn.addEventListener("mouseleave", () => (btn.style.background = off));
    };
    hover(okBtn, c.btnBgHover, c.btnBg);
    hover(cancelBtn, c.cancelBgHover, c.cancelBg);

    let okEnabled = !opts.prompt;
    const setOk = (on: boolean) => {
      okEnabled = on;
      okBtn.style.opacity = on ? "1" : ".5";
      okBtn.style.pointerEvents = on ? "auto" : "none";
    };
    if (input) {
      input.addEventListener("input", () => setOk(input.value.trim() === opts.prompt));
    }

    requestAnimationFrame(() => {
      backdrop.style.opacity = "1";
      panel.style.opacity = "1";
      panel.style.transform = "none";
    });

    let settled = false;
    const close = (result: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      backdrop.style.opacity = "0";
      panel.style.opacity = "0";
      panel.style.transform = "translateY(12px) scale(.98)";
      document.body.style.overflow = prevOverflow;
      setTimeout(() => {
        overlay.remove();
        if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
      }, 200);
      resolve(result);
    };

    const confirm = () => {
      if (okEnabled) close(true);
    };

    okBtn.addEventListener("click", confirm);
    cancelBtn.addEventListener("click", () => close(false));
    backdrop.addEventListener("click", () => close(false));

    // Keyboard: Escape cancels; Enter confirms; Tab is trapped within the panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      } else if (e.key === "Tab") {
        const focusables = [input, cancelBtn, okBtn].filter(Boolean) as HTMLElement[];
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const activeEl = document.activeElement;
        if (e.shiftKey && activeEl === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);

    // Focus the input (type-to-confirm) or Cancel (safer default for destructive actions).
    (input ?? cancelBtn).focus();
  });
}
