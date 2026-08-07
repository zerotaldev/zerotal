/** @jsxImportSource @zerotal/flow */
// A visible answer to "which environment am I about to change data in?"
//
// The expensive mistake is editing production believing it is staging. A border
// and a badge cost nothing and remove the ambiguity entirely, which is why every
// admin panel ecosystem grows a plugin for exactly this.

import type { HtmlNode } from "@zerotal/flow";
import type { RenderHook } from "../renderHooks.ts";

export interface EnvironmentIndicatorOptions {
  /** Environment name. Defaults to `APP_ENV`. */
  environment?: string;
  /**
   * Environments to stay silent in. Local development needs no reminder that it
   * is local — the point is to mark the ones where a mistake costs something.
   */
  quiet?: string[];
  /** Tone per environment; anything unlisted falls back to a warning amber. */
  tones?: Record<string, string>;
}

const DEFAULT_TONES: Record<string, string> = {
  production: "bg-destructive text-destructive-foreground",
  prod: "bg-destructive text-destructive-foreground",
  staging: "bg-amber-500 text-black",
  test: "bg-primary text-primary-foreground",
};

/**
 * A render hook drawing a strip across the top of the panel naming the
 * environment.
 *
 *   Panel.renderHook("body.start", environmentIndicator());
 *
 * Returns `null` in the quiet environments, so registering it unconditionally is
 * the intended usage — there is nothing to switch off per environment.
 */
export function environmentIndicator(options: EnvironmentIndicatorOptions = {}): RenderHook {
  const quiet = new Set(options.quiet ?? ["local", "development", "dev"]);
  const tones = { ...DEFAULT_TONES, ...(options.tones ?? {}) };

  return (): HtmlNode | null => {
    const env = (options.environment ?? Bun.env["APP_ENV"] ?? "").trim();
    if (!env || quiet.has(env.toLowerCase())) return null;

    const tone = tones[env.toLowerCase()] ?? "bg-amber-500 text-black";
    return (
      <div
        // Fixed rather than in flow: a strip that pushes the layout down would
        // shift every page by a few pixels between environments, which is its
        // own kind of confusing.
        class={`pointer-events-none fixed inset-x-0 top-0 z-50 flex h-1.5 items-center justify-center ${tone}`}
      >
        <span
          class={`absolute top-1.5 rounded-b px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}
        >
          {env}
        </span>
      </div>
    );
  };
}
