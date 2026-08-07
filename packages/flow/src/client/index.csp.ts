// ── @zerotal/flow CSP-safe client bundle entry point ─────────────────────────
//
// Built by FlowProvider.onBooting() when `flow.cspSafe` is enabled, producing
// the `/__flow/runtime.js` served to browsers under a strict Content-Security-
// Policy (no `'unsafe-eval'`).
//
// Identical to ./index.ts except it installs the eval-free CSP evaluator
// (cspAdapter) before Alpine.start() and puts the bridge in CSP mode.

import Alpine from "alpinejs";
import morph from "@alpinejs/morph";
import mask from "@alpinejs/mask";
import focus from "@alpinejs/focus";
import collapse from "@alpinejs/collapse";
import anchor from "@alpinejs/anchor";
import persist from "@alpinejs/persist";
import resize from "@alpinejs/resize";

import { initBridge, registerFlowMagic, setCspMode } from "./bridge.ts";
import { registerHeadless } from "./headless.ts";
import { installCspEvaluator } from "./cspAdapter.ts";
import { initClientStore } from "../store.ts";

(window as unknown as Record<string, unknown>).Alpine = Alpine;

// Swap Alpine's evaluator for the eval-free interpreter BEFORE anything evaluates.
installCspEvaluator(Alpine as never);
setCspMode(true); // bridge-managed bindings (flow:text, …) also avoid new Function

Alpine.plugin(morph);
Alpine.plugin(mask);
Alpine.plugin(focus);
Alpine.plugin(collapse);
Alpine.plugin(anchor);
Alpine.plugin(persist);
Alpine.plugin(resize);

registerFlowMagic(Alpine as never);
registerHeadless(Alpine as never);

document.addEventListener("DOMContentLoaded", () => {
  initBridge();
  // Create the reactive global `store` (draining any defineStore() calls) BEFORE Alpine.start,
  // so `$flow.store.*` bindings resolve against one shared object on their first evaluation.
  initClientStore(Alpine as never);
  Alpine.start();
});
