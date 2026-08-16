/**
 * The error that ended the request, and how it got there.
 *
 * The Queries tab leads with the message because on a failed request that is the
 * answer. This is the rest of the answer: the class name, and the stack with
 * every frame a link into your editor.
 *
 * Deliberately *not* filtered to application code, unlike a query's call site.
 * You read a stack trace to find out how you got somewhere, and a trace with the
 * middle removed does not tell you that — so the framework frames stay, marked
 * dim so the ones you wrote stand out of them.
 */
import { copyBtn, esc, sourceLink } from "../ui/format.ts";
import type { TabView } from "./types.ts";

/**
 * Frames from inside the framework, which are context rather than the answer.
 *
 * The same judgement the call-site capture makes, but used to *style* rather than
 * to drop: your own code is what you can act on, and in a forty-frame trace it is
 * six of them.
 */
function isVendorFrame(file: string): boolean {
  const path = file.replace(/\\/g, "/");
  return path.includes("node_modules/") || path.includes("/packages/") || path.startsWith("bun:");
}

export const exceptionsTab: TabView = {
  id: "exceptions",
  label: "Exception",
  scope: "request",

  badge: ({ trace }) => (trace?.exception ? { count: "!", warn: true } : undefined),

  render(host, { trace, store }) {
    const e = trace!.exception;
    if (!e) {
      host.innerHTML = '<p class="empty">This request completed without throwing</p>';
      return;
    }

    const frames = e.frames ?? [];
    const asText =
      `${e.type ?? "Error"}: ${e.message}\n` +
      frames.map((f) => `    at ${f.function ?? "<anonymous>"} (${f.file}:${f.line})`).join("\n");

    const body = frames.length
      ? frames
          .map(
            (f) =>
              `<div class="frame${isVendorFrame(f.file) ? " vendor" : ""}">` +
              `<span class="fnname">${esc(f.function ?? "‹anonymous›")}</span>` +
              sourceLink(f, store.editor) +
              `</div>`,
          )
          .join("")
      : // A failure with no stack is not a bug in the panel: a thrown string, or
        // an error crossing a boundary that dropped it, both arrive this way.
        '<p class="empty">No stack was captured for this failure</p>';

    host.innerHTML =
      `<div class="exc">` +
      `<div class="exhead">✗ ${esc(e.type ?? "Error")} · ${e.status}${copyBtn(asText, "Copy the whole trace")}</div>` +
      `<div class="exmsg">${esc(e.message)}</div>` +
      `</div>` +
      `<div class="sec"><div class="stitle">Stack (${frames.length})</div></div>` +
      `<div>${body}</div>`;
  },
};
