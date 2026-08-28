/** @jsxImportSource @zerotal/flow */
// Minimal centered layout for the guest auth screens (login / forgot / reset).
// Shares the admin theme head (dark/light + tokens) but not the sidebar shell.

import { Layout } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Panel } from "../Panel.ts";
import { adminHead } from "../theme.ts";

/** @internal */
export class AuthLayout extends Layout {
  static override get head(): string {
    const cfg = Panel.config();
    return adminHead(cfg.brand ?? "Admin", cfg.theme);
  }

  render(slot: HtmlNode): HtmlNode {
    const cfg = Panel.config();
    return (
      <div class="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
        <div class="w-full max-w-sm">
          <div class="mb-6 flex flex-col items-center gap-2 text-center">
            <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-sm">
              {cfg.brand.slice(0, 1).toUpperCase()}
            </div>
            <div class="text-lg font-semibold tracking-tight">{cfg.auth?.heading ?? cfg.brand}</div>
          </div>
          <div class="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-7">
            {slot}
          </div>
        </div>
      </div>
    );
  }
}
