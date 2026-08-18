// Signing out in one tab, then acting in another.
//
// The server already handles this correctly: `hydrate()` refuses a snapshot whose
// subject no longer matches the session (`FlowSnapshotOwnershipError`), and the
// provider answers with an error frame carrying `reload: true` and "Your session
// changed — reload the page."
//
// The client dropped that flag on the floor. The handler reloaded for a dev
// soft-refresh and for the literal message "Unknown component", then fell through
// to `console.error` — so the instruction the server had gone to the trouble of
// sending reached a console nobody had open. What the reader saw was a button
// that did nothing: the action rejected, the page still on screen, still signed
// in as far as it looked, and no way to find out otherwise but to reload by hand.

import { describe, it, expect } from "bun:test";
import { _reloadReasonFor } from "./client/bridge.ts";

describe("recovering from an error frame", () => {
  it("reloads when the server says the session changed", () => {
    // The exact frame FlowProvider sends for FlowSnapshotOwnershipError.
    const frame = { message: "Your session changed — reload the page.", reload: true };
    expect(_reloadReasonFor(frame, false)).toBe("session-changed");
  });

  it("does not depend on the message text to do it", () => {
    // The flag is the contract; the sentence is for the reader. Matching on the
    // words would break the moment the message was reworded or translated.
    expect(_reloadReasonFor({ message: "anything at all", reload: true }, false)).toBe(
      "session-changed",
    );
  });

  it("still reloads for an unregistered component after a server restart", () => {
    expect(_reloadReasonFor({ message: "Unknown component" }, false)).toBe("unknown-component");
  });

  it("leaves an ordinary action error alone", () => {
    // A rejected action is not a broken page — reloading would throw away the
    // form the reader is standing in.
    expect(_reloadReasonFor({ message: "Validation failed" }, false)).toBeNull();
    expect(_reloadReasonFor({}, false)).toBeNull();
  });

  it("reloads at most once, whatever the reason", () => {
    // The one-shot guard: a reload that did not fix it must not reload again.
    expect(_reloadReasonFor({ message: "x", reload: true }, true)).toBeNull();
    expect(_reloadReasonFor({ message: "Unknown component" }, true)).toBeNull();
  });
});
