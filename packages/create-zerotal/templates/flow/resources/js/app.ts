import "../css/app.css";
console.log("Zerotal app, welcome from Browser!");

// Global client store — app-wide, client-only reactive UI state (theme, sidebar, …)
// shared across components with no server round-trip. Declare its initial shape here,
// then read/write it in JSX client expressions as `$flow.store.ui.dark`. Type it by
// augmenting `FlowStore` (see resources/js/env.d.ts).
//
// import { defineStore } from "@zerotal/flow/store";
// defineStore({ ui: { dark: false, sidebar: true } });
