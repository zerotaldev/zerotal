/** Jobs dispatched (or processed synchronously) during the request. */
import type { JobEntry } from "../../RequestTrace.ts";
import { esc, fmt } from "../ui/format.ts";
import type { TabView } from "./types.ts";

function icon(status: JobEntry["status"]): string {
  return status === "dispatched" ? "⚙" : status === "completed" ? "✓" : "✗";
}

export const jobsTab: TabView = {
  id: "jobs",
  label: "Jobs",
  scope: "request",

  badge: ({ trace }) =>
    trace
      ? {
          count: trace.jobs?.length ?? 0,
          warn: trace.jobs?.some((j) => j.status === "failed") ?? false,
        }
      : undefined,

  render(host, { trace }) {
    const jobs = trace!.jobs ?? [];
    if (!jobs.length) {
      host.innerHTML = '<p class="empty">No jobs dispatched during this request</p>';
      return;
    }
    host.innerHTML =
      `<div>` +
      jobs
        .map((j) => {
          const chip = j.status === "completed" ? "ok" : j.status === "failed" ? "warn" : "";
          return (
            `<div class="card">` +
            `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">` +
            `<span class="chip ${chip}">${icon(j.status)} ${j.status}</span>` +
            `<span class="dim" style="font-size:10px">+${j.offsetMs}ms · ${fmt(j.durationMs)}</span>` +
            `</div>` +
            `<div style="font-weight:600;margin-bottom:2px">${esc(j.className)}</div>` +
            `<div class="dim" style="font-size:11px">Queue: ${esc(j.queue)}</div>` +
            (j.error
              ? `<div style="color:var(--red);font-size:11px;margin-top:4px">${esc(j.error)}</div>`
              : "") +
            `</div>`
          );
        })
        .join("") +
      `</div>`;
  },
};
