/** @jsxImportSource @zerotal/flow */
// ── <Kbd> ───────────────────────────────────────────────────────────────────
//
// A keyboard key, rendered as one. Used in shortcut hints, command menus and
// help text: `<Kbd>⌘</Kbd><Kbd>K</Kbd>`.
//
// `Kbd.mod` is the one piece of logic here worth having. The modifier key is ⌘ on
// a Mac and Ctrl everywhere else, and which one to draw cannot be known on the
// server — so the glyph is swapped on the client from the platform, and the
// server renders the more common label rather than guessing per request.
//
//   <Kbd>⌘</Kbd>
//   <KbdMod /> <Kbd>K</Kbd>

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface KbdProps {
  class?: string;
  children?: unknown;
  [key: string]: unknown;
}

export function Kbd(props: KbdProps): HtmlNode {
  const { class: cls, children, ...rest } = props;
  return (
    <kbd
      class={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground",
        cls,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}

/**
 * The platform's modifier key — ⌘ on Apple hardware, Ctrl elsewhere.
 *
 * Rendered as `Ctrl` on the server and corrected on the client, so a Mac user
 * sees ⌘ and nobody sees a flash of the wrong glyph on the platform that is
 * statistically more common.
 */
export function KbdMod(props: KbdProps): HtmlNode {
  const { class: cls, ...rest } = props;
  return (
    <Kbd
      {...(cls ? { class: cls } : {})}
      x-data="{ mac: false }"
      x-init="mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)"
      x-text="mac ? '⌘' : 'Ctrl'"
      {...rest}
    >
      Ctrl
    </Kbd>
  );
}
