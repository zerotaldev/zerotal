---
title: "The Small Print of Feeling Fast"
description: "Flow navigates without a reload — but what makes an SPA feel right is the boring browser behaviour it usually throws away. Prefetch on hover, live elements carried across, scroll position that lands where it should, and one word to opt out."
date: 2026-08-10
category: Flow
order: 3
---

# The Small Print of Feeling Fast

Every framework will tell you its client-side navigation is fast. Most of them are telling the truth — swapping a fragment of DOM beats a full document load, and the number in the profiler says so.

Then you use the app, and something is off. You cannot say what. The pages arrive quickly and it still feels cheap.

The reason is almost never the speed. It is that a full page load quietly does about six things for you, and a DOM swap does none of them unless somebody wrote the code. A browser does not just fetch — it puts you at the top of the new page, it remembers where you were on the old one, it stops the media, it moves focus, it lands you on the fragment if the URL names one. Replace the content under a live document and you have opted out of all of it without being asked.

Flow's `navigate` is about that list. Here is what is in it.

## You arrive where you should

Follow a link and you land at the top of the new page — or at the fragment, if the URL names one, exactly as the same link would behave without the swap. Press Back and you return to where you were on the page you left, not to the top of it. Press Forward and the same holds.

That last part is the one that takes the work. When `popstate` fires, `history.state` has already become the destination's, so the entry you are _leaving_ is no longer addressable — you cannot record its position, because by the time you know you are leaving, you have left. Flow keys each history entry and keeps the offsets in a map alongside, so both directions are recorded rather than just the backwards one.

The scroll is applied after the incoming root is in place, which is when the document has its new height and its fragment targets exist. And it is issued as an instant jump, so a site whose CSS sets `scroll-behavior: smooth` does not animate the entire way up on every single visit.

## Except when you shouldn't

Some links are not going anywhere. A sort header, a filter chip, a tab strip halfway down a long page — for those, jumping to the top throws away the control the user was looking at when they clicked it.

```tsx
<Link href={this.currentUrl({ query: { sort: "title" } })} preserveScroll>
  Title
</Link>
```

`this.navigateCurrent({ query: { status }, preserveScroll: true })` does the same thing for the filter helper, which is the more common home for it — a `<select>` that re-queries as you change it should not fling the results out of view. Pagination is the opposite case and wants the default, because page two really should start at the top.

## The page is already there when you click

`hover` starts fetching the target after about sixty milliseconds of hover and caches the HTML, so the click swaps from memory instead of waiting on a cold request:

```tsx
<Link href="/posts" hover>
  Posts
</Link>
```

The dwell matters as much as the prefetch — it is what stops a pointer crossing a nav bar from firing a request for every link it passes over. What it buys is that the round trip happens while the user is still deciding, rather than after they have committed.

## What should survive, survives

A DOM swap throws away live elements — which is fine for a table and disastrous for a playing audio element, a video, or a scrolled sidebar that resets every time you change page. `<Persist>` marks a subtree to be carried across a navigation rather than replaced:

```tsx
<Persist name="player">
  <audio controls src={this.track} />
</Persist>
```

The node itself moves into the incoming page, so its state moves with it: playback position, volume, focus, scroll.

## The active link knows it is active

The bridge sets `data-current` on whichever `navigate` link matches the URL, so the nav styles itself:

```tsx
<Link href="/posts" class="data-[current]:font-bold">
  Posts
</Link>
```

It matches by prefix, so a link to `/posts` stays active on `/posts/42` — which is what you want for a section parent. Add `exact` for an index link that should only light up on its own URL, or `current={false}` to opt a link out entirely.

## And it animates, where the browser can

Where View Transitions are supported, the swap is wrapped in one, so pages cross-fade rather than snapping. Where they are not — or where the visitor has asked for reduced motion — it is an instant swap, no configuration either way.

---

None of this is the interesting part of building an application, which is precisely the argument for it being in the framework. `@zerotal/flow` from 1.4.0; `preserveScroll` is documented on `<Link>` in [Components](/docs/flow/components) and on `navigateCurrent()` in [Routing](/docs/flow/routing).
