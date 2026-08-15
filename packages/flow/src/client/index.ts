// ── @zerotal/flow client bundle entry point ─────────────────────────────────────
//
// This file is the entry point for Bun.build() in FlowProvider.onBooting().
// It produces /__flow/runtime.js served to browsers.
//
// Includes:
//   - Alpine.js core
//   - @alpinejs/morph plugin (DOM diffing)
//   - UI plugins: mask, focus (x-trap/$focus), collapse, anchor, persist ($persist), resize (x-resize)
//   - Flow WS bridge + $flow magic

import Alpine from "alpinejs";
import morph from "@alpinejs/morph";
import mask from "@alpinejs/mask";
import focus from "@alpinejs/focus";
import collapse from "@alpinejs/collapse";
import anchor from "@alpinejs/anchor";
import persist from "@alpinejs/persist";
import resize from "@alpinejs/resize";

import { initBridge, registerFlowMagic } from "./bridge.ts";
import { registerHeadless } from "./headless.ts";
import { initClientStore } from "../store.ts";
import { installClientRoutes } from "./routes.ts";

// Install the route table before anything can evaluate a `$route(...)` binding.
installClientRoutes();

// Expose Alpine on window so FlowComponent and third-party Alpine plugins
// can access it via window.Alpine (standard Alpine convention).
(window as unknown as Record<string, unknown>).Alpine = Alpine;

// Register Alpine plugins (morph powers server patches; the rest back the Tier 3
// directives: mask → x-mask, focus → x-trap/$focus, collapse → x-collapse,
// anchor → x-anchor, persist → $persist, resize → x-resize).
Alpine.plugin(morph);
Alpine.plugin(mask);
Alpine.plugin(focus);
Alpine.plugin(collapse);
Alpine.plugin(anchor);
Alpine.plugin(persist);
Alpine.plugin(resize);

// Register $flow magic BEFORE Alpine.start() so it's available in x-data
registerFlowMagic(Alpine as never);

// Register headless Alpine.data factories (flowRadioGroup, flowListbox).
registerHeadless(Alpine as never);

// initBridge() MUST run before Alpine.start(). Alpine evaluates x-text / x-show
// expressions immediately on start; the $flow magic needs _components populated
// (by initBridge) or it returns undefined and no reactive dependency is tracked —
// meaning x-text bindings would never update after the initial render.
document.addEventListener("DOMContentLoaded", () => {
  initBridge(); // ← registers FlowComponents into _components first
  // Create the reactive global `store` (draining any defineStore() calls queued at
  // app start) BEFORE Alpine.start, so `store.*` bindings resolve on first evaluation.
  initClientStore(Alpine as never);
  Alpine.start(); // ← then Alpine processes x-text etc. with $flow + store working
});
