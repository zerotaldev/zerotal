/**
 * Restarts must not overlap.
 *
 * The debounce timer only spaced out the *scheduling* of a restart. Its callback cleared
 * the timer and then awaited a rebuild that can take seconds — and a change arriving in
 * that window scheduled a second callback which ran concurrently. Both reached
 * `_spawnServer()`, so two servers raced for the same port: one won, the other died with
 *
 *     ✖ Failed to start server. Is port 3000 in use?
 *       [zerotal:dev] server exited with code 1
 *
 * and dev mode was left with no server it owned, while the winner kept serving. Every
 * later save then looked like it did nothing.
 *
 * The process work is stubbed and every wait is an explicit gate the test releases, so
 * these assert ordering deterministically rather than racing real timers — a flaky test
 * about a race is worth less than no test at all.
 */
import { describe, it, expect } from "bun:test";
import { DevOrchestrator } from "./DevOrchestrator.ts";

/** A promise the test resolves by hand, standing in for slow work. */
function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

interface Harness {
  orchestrator: DevOrchestrator;
  events: string[];
  /** Servers live at once — must never exceed 1. */
  peak: () => number;
  /** Releases the gate blocking the current rebuild, and lets microtasks drain. */
  finishBuild: () => Promise<void>;
}

function harness(): Harness {
  const events: string[] = [];
  let live = 0;
  let peak = 0;
  let pending: (() => void)[] = [];

  const orchestrator = new DevOrchestrator(3000, "/app", async () => ({
    success: true,
    logs: [],
  }));

  // These are private; a test reaching them is the price of asserting the ordering of
  // process work without spawning processes.
  const internals = orchestrator as unknown as Record<string, unknown>;

  internals["_runBuild"] = async (): Promise<boolean> => {
    events.push("build");
    const g = gate();
    pending.push(g.release);
    await g.wait;
    return true;
  };

  // Mirrors the real shape: read the current child, clear the field, then await its
  // exit. That await is the window the race lived in — two concurrent restarts could
  // both observe "no child to stop" and both go on to bind the port.
  internals["_stopChild"] = async function (this: Record<string, unknown>): Promise<void> {
    events.push("stop");
    const child = this["_child"];
    this["_child"] = null;
    if (!child) return;
    await Promise.resolve(); // yield, as awaiting process exit does
    live -= 1;
  };

  internals["_spawnServerWithRetry"] = async function (
    this: Record<string, unknown>,
  ): Promise<void> {
    events.push("spawn");
    live += 1;
    peak = Math.max(peak, live);
    this["_child"] = { pid: live };
  };

  return {
    orchestrator,
    events,
    peak: () => peak,
    finishBuild: async () => {
      // Release every build gate opened so far, then let the continuations run.
      const releases = pending;
      pending = [];
      for (const release of releases) release();
      for (let i = 0; i < 50; i++) await Promise.resolve();
    },
  };
}

/** Drive the private restart entry point. */
function requestRestart(o: DevOrchestrator): Promise<void> {
  return (o as unknown as { _requestRestart(): Promise<void> })._requestRestart();
}

describe("concurrent restart requests", () => {
  it("never runs two restarts at once", async () => {
    const h = harness();

    // Three changes land while the first rebuild is still running — the exact shape
    // that produced two servers competing for the port.
    const a = requestRestart(h.orchestrator);
    const b = requestRestart(h.orchestrator);
    const c = requestRestart(h.orchestrator);

    await h.finishBuild(); // first restart's build
    await h.finishBuild(); // the coalesced follow-up's build
    await Promise.all([a, b, c]);

    expect(h.peak()).toBe(1);
  });

  it("always stops the old server before spawning a new one", async () => {
    const h = harness();

    const a = requestRestart(h.orchestrator);
    const b = requestRestart(h.orchestrator);
    await h.finishBuild();
    await h.finishBuild();
    await Promise.all([a, b]);

    const spawnAt = h.events.flatMap((e, i) => (e === "spawn" ? [i] : []));
    expect(spawnAt.length).toBeGreaterThan(0);
    for (const i of spawnAt) expect(h.events[i - 1]).toBe("stop");
  });

  it("coalesces a burst into one follow-up, not one restart per change", async () => {
    const h = harness();

    const requests = Array.from({ length: 6 }, () => requestRestart(h.orchestrator));
    await h.finishBuild();
    await h.finishBuild();
    await Promise.all(requests);

    // The in-flight restart, plus exactly one more covering everything queued behind it.
    expect(h.events.filter((e) => e === "spawn")).toHaveLength(2);
  });

  it("accepts a fresh restart once the previous run has drained", async () => {
    const h = harness();

    const first = requestRestart(h.orchestrator);
    await h.finishBuild();
    await first;

    const second = requestRestart(h.orchestrator);
    await h.finishBuild();
    await second;

    expect(h.events.filter((e) => e === "spawn")).toHaveLength(2);
    expect(h.peak()).toBe(1);
  });
});
