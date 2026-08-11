/**
 * `@zerotal/flow/browser` — drive a real browser against a running Flow app.
 *
 * The counterpart to `@zerotal/flow/testing`. `FlowTest` exercises a component's
 * logic by calling its actions directly; `FlowBrowser` exercises everything
 * between a user's click and that action — the rendered attribute, the delegated
 * listener, the WebSocket frame, the patch that comes back. Flow's silent
 * failures have all lived in that gap, so the two are complementary rather than
 * alternatives: unit-test behaviour with `FlowTest`, and pin the wiring with a
 * handful of `FlowBrowser` tests.
 *
 * Needs a Chrome or Edge install (or `CHROME_PATH`). Guard a suite with
 * {@link FlowBrowser.available} so it skips, rather than fails, without one.
 *
 * @packageDocumentation
 */
export { FlowBrowser } from "./FlowBrowser.ts";
export type { OpenOptions } from "./FlowBrowser.ts";
export { findChrome } from "./cdp.ts";
