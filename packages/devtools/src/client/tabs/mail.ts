/** Emails sent or queued during the request, each with a sandboxed preview. */
import type { MailEntry } from "../../RequestTrace.ts";
import { esc, fmt } from "../ui/format.ts";
import type { TabView } from "./types.ts";

/**
 * The rendered email, in a frame that can do nothing.
 *
 * The HTML has crossed the wire on every request since mail capture landed and
 * had never been shown. It cannot simply be inserted: the panel lives in a shadow
 * root on the app's own origin, so injecting a template's markup inline is a
 * self-XSS on every dev machine that renders a mail containing user input. An
 * empty `sandbox` allows nothing — no scripts, no same-origin, no forms, no
 * navigation — which is the whole of what a preview needs.
 *
 * Collapsed by default: the point of the tab is which mails were sent, and three
 * open previews push that off the screen. Keyed rendering means an open preview
 * now survives the next request arriving, rather than reloading its iframe.
 */
function preview(m: MailEntry): string {
  if (!m.html) return "";
  return (
    `<details class="mprev"><summary>Preview</summary>` +
    `<iframe class="mframe" sandbox="" srcdoc="${esc(m.html)}" title="${esc(m.subject)}"></iframe>` +
    `</details>`
  );
}

export const mailTab: TabView = {
  id: "mail",
  label: "Mail",

  badge: ({ trace }) => (trace ? { count: trace.mail?.length ?? 0 } : undefined),

  render(host, { trace }) {
    const mail = trace!.mail ?? [];
    if (!mail.length) {
      host.innerHTML = '<p class="empty">No emails sent during this request</p>';
      return;
    }
    host.innerHTML =
      `<div>` +
      mail
        .map(
          (m) =>
            `<div class="card">` +
            `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">` +
            `<span class="chip${m.queued ? "" : " ok"}">${m.queued ? "⏳ Queued" : "✓ Sent"}</span>` +
            `<span class="dim" style="font-size:10px">${esc(m.className)} · ${fmt(m.durationMs)}</span>` +
            `</div>` +
            `<div style="font-weight:700;margin-bottom:2px">${esc(m.subject)}</div>` +
            `<div class="dim" style="font-size:11px">To: ${esc(m.to.join(", "))}</div>` +
            preview(m) +
            `</div>`,
        )
        .join("") +
      `</div>`;
  },
};
