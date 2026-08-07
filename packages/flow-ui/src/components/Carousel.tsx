/** @jsxImportSource @zerotal/flow */
// ── <Carousel> ──────────────────────────────────────────────────────────────
//
// A horizontally scrolling strip of items with previous/next controls.
//
// Built on native scroll snapping rather than a transform-based slider. The
// difference shows up on a phone: a native scroller responds to a swipe with the
// platform's own momentum and rubber-banding, and a transform slider has to
// reimplement all of it, usually less well. The arrows scroll the same container,
// so both input methods drive one mechanism instead of competing.
//
// No autoplay. A strip that moves on its own takes the reading position away from
// whoever is looking at it, and every accessibility guideline that mentions it
// says to provide a way to stop it — the simplest way to provide that is not to
// start.
//
//   <Carousel items={products.map((p) => <ProductCard product={p} />)} />

import type { HtmlNode } from "@zerotal/flow";
import { cn } from "../utils/cn.ts";

export interface CarouselProps {
  items: unknown[];
  /** Tailwind width for each slide. Defaults to a responsive card width. */
  itemClass?: string;
  /** Hide the arrows, leaving swipe and scroll only. */
  hideControls?: boolean;
  /** Accessible name for the region. */
  label?: string;
  class?: string;
  [key: string]: unknown;
}

function Arrow({ dir }: { dir: "prev" | "next" }): HtmlNode {
  return (
    <svg
      class="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={dir === "prev" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

const controlClass =
  "absolute top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-opacity hover:bg-accent disabled:pointer-events-none disabled:opacity-0";

export function Carousel(props: CarouselProps): HtmlNode {
  const {
    items,
    itemClass = "w-64 sm:w-72",
    hideControls,
    label = "Carousel",
    class: cls,
    ...rest
  } = props;

  // One page is a viewport's worth, which is what a reader expects an arrow to
  // advance — not one item, which feels broken when several are visible.
  const state = `{
    atStart: true,
    atEnd: false,
    sync() {
      const el = $refs.track;
      this.atStart = el.scrollLeft <= 1;
      this.atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    },
    page(dir) {
      $refs.track.scrollBy({ left: dir * $refs.track.clientWidth * 0.9, behavior: 'smooth' });
    }
  }`.replace(/\s+/g, " ");

  return (
    <div
      x-data={state}
      x-init="sync()"
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      class={cn("relative", cls)}
      {...rest}
    >
      <div
        x-ref="track"
        {...{ "x-on:scroll.debounce.50ms": "sync()" }}
        // `snap-x` with `snap-start` on each slide is what makes a swipe land on
        // an item rather than anywhere.
        class="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <div class={cn("shrink-0 snap-start", itemClass)}>{item}</div>
        ))}
      </div>

      {hideControls ? null : (
        <>
          <button
            type="button"
            aria-label="Previous"
            {...{ "x-on:click": "page(-1)" }}
            {...{ "x-bind:disabled": "atStart" }}
            class={cn(controlClass, "left-0 -translate-x-1/2")}
          >
            <Arrow dir="prev" />
          </button>
          <button
            type="button"
            aria-label="Next"
            {...{ "x-on:click": "page(1)" }}
            {...{ "x-bind:disabled": "atEnd" }}
            class={cn(controlClass, "right-0 translate-x-1/2")}
          >
            <Arrow dir="next" />
          </button>
        </>
      )}
    </div>
  );
}
