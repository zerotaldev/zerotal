// ── Streaming rendering ───────────────────────────────────────────────────────
//
// `<SlowWidget stream />` renders its placeholder immediately and its real
// markup later, on the *same HTTP response*. The shell reaches the browser
// without waiting for the slow child; the child's HTML arrives as a trailing
// chunk and is swapped in by a one-line inline script.
//
// ## How this differs from `lazy` / `defer`
//
// `lazy` and `defer` also paint a placeholder first, but the real render happens
// on a **second round trip**: the client mounts the child over the socket once
// it is visible (`lazy`) or once the document is parsed (`defer`). That is the
// right tool when the content may never be needed — a widget below the fold, a
// tab nobody opens.
//
// `stream` is for content that is definitely needed and merely slow. There is no
// second request, no socket involvement, and no client runtime requirement: the
// swap happens during parse, so it works before (and without) Alpine.
//
// ## Degradation
//
// Streaming needs an unbuffered response. Behind a proxy that buffers, the
// browser simply receives the whole document at once and the swap scripts run in
// order — the page is correct, just not progressive. Nothing detects or reports
// this, because there is nothing the app could do about it.

import { AsyncLocalStorage } from "node:async_hooks";

/** One child whose real markup is still being rendered. */
export interface PendingStream {
  /** `data-flow-id` of the placeholder root this will replace the contents of. */
  childId: string;
  /** Resolves to the child's finished inner HTML plus its state script. */
  render: () => Promise<string>;
}

/** Per-request streaming state. */
export interface StreamStore {
  readonly pending: PendingStream[];
}

const _storage = new AsyncLocalStorage<StreamStore>();

/** A fresh store for one request. */
export function createStreamStore(): StreamStore {
  return { pending: [] };
}

/** Run `fn` with `store` as the active stream store for the current async chain. */
export function runWithStreaming<T>(store: StreamStore, fn: () => T): T {
  return _storage.run(store, fn);
}

/**
 * The active store, or `undefined` when streaming is not available.
 *
 * Absent during WebSocket patches, which have no response to stream on. Callers
 * treat that as "render this child inline instead", so `stream` degrades to an
 * ordinary child rather than failing.
 */
export function getStreamStore(): StreamStore | undefined {
  return _storage.getStore();
}

/** Queue a child to be rendered after the shell has been flushed. */
export function queueStream(entry: PendingStream): void {
  _storage.getStore()?.pending.push(entry);
}

/**
 * The chunk that swaps one streamed child into place.
 *
 * The markup rides in a `<template>` so the parser will not execute or render it
 * where it lands, and the script that follows moves it into the placeholder and
 * removes itself. `document.currentScript` is used rather than an id lookup so
 * the pair stays self-contained and repeatable.
 */
export function streamChunk(childId: string, html: string): string {
  const id = JSON.stringify(childId);
  return (
    `<template data-flow-stream-for="${_escapeAttr(childId)}">${html}</template>` +
    `<script>(function(){var s=document.currentScript;var t=s.previousElementSibling;` +
    `var host=document.querySelector('[data-flow-id='+CSS.escape(${id})+']');` +
    `if(host&&t){host.innerHTML='';host.appendChild(t.content.cloneNode(true));` +
    `host.removeAttribute('data-flow-streaming');}` +
    `if(t)t.remove();s.remove();})()</script>`
  );
}

function _escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
