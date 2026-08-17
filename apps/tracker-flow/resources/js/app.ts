import "../css/app.css";

// The `@zerotal/client/Socket` subpath, not the package root. The root also
// exports `ClientProvider`, which imports `@zerotal/core` and so reaches the CLI
// command modules — one of which does `await import("bun")`. That is a hard
// error in a browser bundle before tree-shaking gets a chance to drop it.
import { Socket } from "@zerotal/client/Socket";

/**
 * The broadcast connection, published where Flow looks for it.
 *
 * This is the only line of client code the app writes, and it is the one that
 * makes the issue thread live: Flow's `@on("echo…")` listeners subscribe through
 * `window.Echo` on component mount, and when it is absent they are **silently
 * inert** — no error, no warning, no subscription. So a missing script here does
 * not look like a broken script; it looks like a feature that was never built.
 *
 * A second socket alongside Flow's own, and deliberately: Flow's carries this
 * component's state patches, Echo's carries application broadcasts that any
 * client may subscribe to. Merging them would mean every broadcast subscriber
 * also holding a component.
 */
declare global {
  interface Window {
    Echo?: Socket;
  }
}

window.Echo = new Socket();
