// The browser's side of the transport, as pure policies tested without a DOM.
//
// Three failures, each of which left a page that looked alive with nothing working:
//
// - A slow action (past the 15 s ack wait) released the send queue, so the next click went out
//   from the old snapshot. When both replies landed, the second delta was applied to a snapshot
//   it was not computed against, the rebuilt snapshot no longer verified, and every later action
//   was refused as "Invalid snapshot".
// - A network that swallows WebSocket upgrades held the page on three browser-length timeouts
//   before it fell back to HTTP.
// - An error frame reached `console.error` and nothing else, and "Invalid snapshot" left the
//   page refusing every action until the visitor reloaded by hand.
import { describe, it, expect, beforeEach } from "bun:test";
import {
  _errorNoticeFor,
  _fallBackToHttp,
  _flowErrorDetail,
  _fullSyncInternals,
  _patchBaseDecision,
  _reloadReasonFor,
  _resyncInternals,
} from "./client/bridge.ts";

/** Whether `promise` settles within a couple of ticks. */
async function settles(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return done;
}

describe("applying a patch", () => {
  it("applies a delta computed against the snapshot the browser holds", () => {
    expect(_patchBaseDecision({ base: "held" }, "held")).toBe("apply");
  });

  it("sets aside a delta computed against another snapshot and asks for the whole one", () => {
    // The second reply of two that raced: its base is the snapshot both were sent from.
    expect(_patchBaseDecision({ base: "older" }, "held")).toBe("resync");
  });

  it("takes a full snapshot whatever the browser holds", () => {
    expect(_patchBaseDecision({ snapshot: { checksum: "x" } }, "held")).toBe("full");
    expect(_patchBaseDecision({ snapshot: { checksum: "x" }, base: "older" }, "held")).toBe("full");
  });

  it("applies a patch with no base as before, so a mixed deploy cannot loop on resyncs", () => {
    expect(_patchBaseDecision({}, "held")).toBe("apply");
  });
});

describe("the hold a resync puts on a component's queue", () => {
  beforeEach(() => _fullSyncInternals.reset());

  it("keeps the next action waiting until the full snapshot lands", async () => {
    const sent: string[] = [];
    _fullSyncInternals.begin("c1", (id) => (sent.push(id), true));

    expect(sent).toEqual(["c1"]);
    expect(await settles(_fullSyncInternals.queue("c1"))).toBe(false);

    _fullSyncInternals.end("c1", () => true);

    expect(await settles(_fullSyncInternals.queue("c1"))).toBe(true);
    expect(_fullSyncInternals.active("c1")).toBe(false);
  });

  it("holds behind an action still in flight, and asks for the snapshot at once", async () => {
    const ack = _fullSyncInternals.inFlight("c1");
    const sent: string[] = [];
    _fullSyncInternals.begin("c1", (id) => (sent.push(id), true));
    expect(sent).toEqual(["c1"]);

    ack();
    expect(await settles(_fullSyncInternals.queue("c1"))).toBe(false);

    _fullSyncInternals.end("c1", () => true);
    expect(await settles(_fullSyncInternals.queue("c1"))).toBe(true);
  });

  it("asks once more when another patch was set aside while it waited", async () => {
    // The reply to the first request may predate what the set-aside patch carried.
    let sends = 0;
    const send = (): boolean => (sends++, true);
    _fullSyncInternals.begin("c1", send);
    _fullSyncInternals.begin("c1", send); // a second unappliable patch: no second request yet
    expect(sends).toBe(1);

    _fullSyncInternals.end("c1", send);
    expect(sends).toBe(2);
    expect(await settles(_fullSyncInternals.queue("c1"))).toBe(false);

    _fullSyncInternals.end("c1", send);
    expect(sends).toBe(2);
    expect(await settles(_fullSyncInternals.queue("c1"))).toBe(true);
  });

  it("releases the queue and leaves the resync for the reconnect when it cannot be sent", async () => {
    _resyncInternals.clear();
    _fullSyncInternals.begin("c1", () => false);

    expect(await settles(_fullSyncInternals.queue("c1"))).toBe(true);
    expect(_resyncInternals.isStale("c1")).toBe(true);
  });

  it("releases the queue when it gets no reply", async () => {
    _fullSyncInternals.begin("c1", () => true);

    _fullSyncInternals.abandon("c1");

    expect(await settles(_fullSyncInternals.queue("c1"))).toBe(true);
    expect(_resyncInternals.isStale("c1")).toBe(true);
  });

  it("releases the queue when the server refuses it", async () => {
    _fullSyncInternals.begin("c1", () => true);

    _fullSyncInternals.fail("c1");

    expect(await settles(_fullSyncInternals.queue("c1"))).toBe(true);
    expect(_fullSyncInternals.active("c1")).toBe(false);
  });
});

describe("falling back to HTTP", () => {
  const base = { failures: 1, timedOut: false, everOpened: false, httpMode: false };

  it("switches at once when the very first handshake hangs", () => {
    // What a proxy that swallows upgrades looks like: no refusal, just nothing.
    expect(_fallBackToHttp({ ...base, timedOut: true })).toBe(true);
  });

  it("waits for three failures when the handshake is refused outright", () => {
    expect(_fallBackToHttp(base)).toBe(false);
    expect(_fallBackToHttp({ ...base, failures: 2 })).toBe(false);
    expect(_fallBackToHttp({ ...base, failures: 3 })).toBe(true);
  });

  it("does not take a slow reconnect for a blocked network once a socket has opened", () => {
    expect(_fallBackToHttp({ ...base, timedOut: true, everOpened: true })).toBe(false);
  });

  it("does nothing when the page is already on HTTP", () => {
    expect(_fallBackToHttp({ ...base, timedOut: true, failures: 9, httpMode: true })).toBe(false);
  });
});

describe("an error frame in the browser", () => {
  it("is announced with its component, message and code", () => {
    expect(
      _flowErrorDetail({ component: "c1", message: "Invalid snapshot", code: "invalid_snapshot" }),
    ).toEqual({ component: "c1", message: "Invalid snapshot", code: "invalid_snapshot" });
  });

  it("is announced even when the frame names no component or code", () => {
    expect(_flowErrorDetail({ message: "Malformed frame" })).toEqual({
      component: null,
      message: "Malformed frame",
      code: "error",
    });
  });

  it("shows the message a server error carries, which the server chose for the visitor", () => {
    expect(
      _errorNoticeFor({ code: "server_error", message: "Something went wrong. Please try again." }),
    ).toEqual({ level: "error", message: "Something went wrong. Please try again." });
  });

  it("shows one plain sentence for a refusal worded for a developer", () => {
    for (const frame of [
      { code: "blocked", message: "Request blocked by middleware (403)" },
      { code: "method_not_allowed", message: 'Method "wipe" is not allowed' },
      { code: "rate_limited", message: "Too many invalid requests" },
      { message: "Malformed frame" },
    ]) {
      expect(_errorNoticeFor(frame)).toEqual({
        level: "error",
        message: "Something went wrong. Please try again.",
      });
    }
  });

  it("shows no notice when the development overlay shows the error instead", () => {
    expect(_errorNoticeFor({ code: "action_failed", message: "boom", stack: "Error: boom" })).toBe(
      null,
    );
  });

  it("reloads once for a snapshot the server refused", () => {
    expect(_reloadReasonFor({ message: "Invalid snapshot", code: "invalid_snapshot" }, false)).toBe(
      "invalid-snapshot",
    );
    expect(_reloadReasonFor({ message: "Invalid snapshot", code: "invalid_snapshot" }, true)).toBe(
      null,
    );
  });

  it("does not reload when the refusals were rate limited", () => {
    expect(
      _reloadReasonFor({ message: "Too many invalid requests", code: "rate_limited" }, false),
    ).toBeNull();
  });

  it("reloads once for a snapshot issued by an earlier release", () => {
    expect(_reloadReasonFor({ message: "x", code: "stale_snapshot", reload: true }, false)).toBe(
      "page-outdated",
    );
    expect(_reloadReasonFor({ message: "x", code: "stale_snapshot", reload: true }, true)).toBe(
      null,
    );
  });
});
