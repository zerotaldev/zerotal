/** @jsxImportSource @zerotal/flow */
// ── <Command> ───────────────────────────────────────────────────────────────
//
// A searchable command menu — the ⌘K palette. Type to filter, arrow keys to
// move, Enter to go, Escape to leave.
//
// Entirely client-side, through Alpine. Filtering, ranking and navigation all
// answer within a frame because they never leave the browser: the items ship
// once with the page and every keystroke is matched from memory. A palette that
// waited on the network between keystrokes would miss the only thing it is for.
//
// That puts a practical ceiling on how many items belong here — a few hundred
// destinations is fine, a table of ten thousand records wants a search page with
// a server query behind it.
//
// Matching is subsequence-based rather than substring, so "npr" finds "New
// Product" the way an editor's fuzzy-open does.
//
//   <Command items={[{ label: "Products", href: "/admin/products", group: "Go to" }]} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface CommandItem {
  label: string;
  /** Where it goes. Omit for an item driven by `action`. */
  href?: string | undefined;
  /** A Flow expression run instead of navigating. */
  action?: string | undefined;
  /** Heading this item sits under. */
  group?: string | undefined;
  /** Extra words that should match — synonyms, a resource's plural. */
  keywords?: string | undefined;
  /** Shortcut hint shown on the right. */
  shortcut?: string | undefined;
}

export interface CommandProps {
  items: CommandItem[];
  /** Placeholder in the search box. */
  placeholder?: string;
  /** Shown when nothing matches. */
  emptyMessage?: string;
  /**
   * Key that opens it, with the platform modifier. Defaults to `k`.
   * Pass `null` to mount it closed with no global shortcut, opened by your own code.
   */
  hotkey?: string | null;
  class?: string;
  [key: string]: unknown;
}

export function Command(props: CommandProps): HtmlNode {
  const {
    items,
    placeholder = "Search…",
    emptyMessage = "Nothing found.",
    hotkey = "k",
    class: cls,
    ...rest
  } = props;

  return (
    <div
      x-data={`flowCommand(${JSON.stringify({ items, hotkey })})`}
      x-show="open"
      x-cloak
      {...{ "x-transition.opacity": true }}
      {...{ "x-on:click": "if ($event.target === $el) hide()" }}
      {...{ "x-on:keydown.escape.window": "hide()" }}
      class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      {...rest}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        class={cn(
          "w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl",
          cls,
        )}
      >
        <div class="flex items-center gap-2 border-b border-border px-3">
          <svg
            class="h-4 w-4 shrink-0 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            x-ref="field"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="flow-command-list"
            autocomplete="off"
            placeholder={placeholder}
            {...{ "x-model": "query" }}
            // Reset the highlight whenever the result set changes, or the
            // selection lands on whatever happens to be at the old index.
            {...{ "x-on:input": "active = 0" }}
            {...{ "x-on:keydown.arrow-down.prevent": "move(1)" }}
            {...{ "x-on:keydown.arrow-up.prevent": "move(-1)" }}
            {...{ "x-on:keydown.enter.prevent": "choose()" }}
            class="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div id="flow-command-list" role="listbox" class="max-h-80 overflow-y-auto p-2">
          <template {...{ "x-for": "(item, i) in results()", ":key": "item.label + i" }}>
            <div>
              {/* The heading renders on the first row of each group, so the
                  list stays one flat loop rather than a nested one. */}
              <div
                {...{ "x-show": "startsGroup(i)" }}
                {...{ "x-text": "item.group" }}
                class="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              />
              <div
                role="option"
                {...{ ":aria-selected": "active === i" }}
                {...{ "x-on:click": "choose(i)" }}
                {...{ "x-on:mousemove": "active = i" }}
                {...{ ":class": "active === i && 'bg-accent text-accent-foreground'" }}
                class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm"
              >
                <span class="flex-1 truncate" {...{ "x-text": "item.label" }} />
                <span
                  {...{ "x-show": "item.shortcut" }}
                  {...{ "x-text": "item.shortcut" }}
                  class="text-[11px] text-muted-foreground"
                />
              </div>
            </div>
          </template>

          <p
            {...{ "x-show": "results().length === 0" }}
            class="px-4 py-8 text-center text-sm text-muted-foreground"
          >
            {emptyMessage}
          </p>
        </div>
      </div>
    </div>
  );
}
