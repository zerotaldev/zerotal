/**
 * The app's stylesheet, and nothing else.
 *
 * The broadcast connection used to be set up here — `window.Socket = new
 * Socket()` — because Flow's `@on("socket:…")` listeners subscribe through that
 * global and were **silently inert** without it: no error, no warning, no
 * subscription, so a live feature with no script looked exactly like a live
 * feature that was never written. The runtime bundles the client and creates it
 * on first use now, so there is nothing here to forget.
 *
 * An app that needs a configured client — a different host, its own auth
 * endpoint — still assigns `window.Socket` before the runtime loads, and that
 * one is used as-is.
 */
import "../css/app.css";
