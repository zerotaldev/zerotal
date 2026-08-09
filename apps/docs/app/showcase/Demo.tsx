/** @jsxImportSource @zerotal/flow */
import type { HtmlNode } from "@zerotal/flow";
import { highlight } from "./highlight.ts";

/**
 * A showcase demo: the live component on top, its usage code below (shadcn-style). `children`
 * is the rendered component; `code` is the source shown underneath. The copy button is pure
 * client-side Alpine (the Flow runtime bundles Alpine) — no server round-trip.
 */
export function Demo(props: { code: string; children?: unknown }): HtmlNode {
  return (
    <div
      class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      x-data="{ copied: false }"
    >
      <div class="p-6">{props.children}</div>

      <div class="relative border-t border-slate-800 bg-slate-900">
        <button
          type="button"
          x-on:click="navigator.clipboard.writeText($refs.code.textContent); copied = true; setTimeout(() => copied = false, 1500)"
          class="absolute right-3 top-3 z-10 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
        >
          <span x-text="copied ? 'Copied!' : 'Copy'" />
        </button>
        <pre class="m-0 overflow-x-auto p-5 text-xs leading-relaxed text-slate-100 sm:text-sm">
          <code x-ref="code" dangerouslySetInnerHTML={{ __html: highlight(props.code) }} />
        </pre>
      </div>
    </div>
  );
}
