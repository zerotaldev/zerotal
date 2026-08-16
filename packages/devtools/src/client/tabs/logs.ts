/** Console output captured during the request. */
import { copyBtn, esc, sourceLink } from "../ui/format.ts";
import type { TabView } from "./types.ts";

export const logsTab: TabView = {
  id: "logs",
  label: "Logs",

  badge: ({ trace }) => {
    const logs = trace?.logs ?? [];
    if (!trace) return undefined;
    return {
      count: logs.length,
      warn: logs.some((l) => l.level === "error" || l.level === "warn"),
    };
  },

  render(host, { trace, store }) {
    const logs = trace!.logs ?? [];
    if (!logs.length) {
      host.innerHTML = '<p class="empty">No console output captured</p>';
      return;
    }
    host.innerHTML =
      `<div>` +
      logs
        .map((l) => {
          const message = l.args.join(" ");
          return (
            `<div class="lrow">` +
            `<span class="ltime dim">+${l.offsetMs}ms</span>` +
            `<span class="llvl ${l.level}">${l.level.toUpperCase()}</span>` +
            `<span class="lmsg">${esc(message)}</span>` +
            // Where it was logged from. A stray `console.log` in a codebase you
            // did not write all of is otherwise a search.
            sourceLink(l.source, store.editor) +
            copyBtn(message, "Copy line") +
            `</div>`
          );
        })
        .join("") +
      `</div>`;
  },
};
