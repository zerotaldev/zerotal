/**
 * The supervisor's job is to be boring: keep things running, give up sensibly,
 * and never let one process take another down with it. Everything here runs on
 * a fake spawner with millisecond backoff, so the assertions are about policy
 * rather than about whether timers fire.
 */
import { describe, it, expect } from "bun:test";
import { DevSupervisor } from "./DevSupervisor.ts";
import type { DevChild } from "./DevSupervisor.ts";
import type { ResolvedDevProcess } from "./DevProcess.ts";

/** A child the test drives by hand. */
class FakeChild implements DevChild {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  readonly signals: string[] = [];

  private _out!: ReadableStreamDefaultController<Uint8Array>;
  private _err!: ReadableStreamDefaultController<Uint8Array>;
  private _settle!: (code: number) => void;

  constructor() {
    this.stdout = new ReadableStream({
      start: (controller) => {
        this._out = controller;
      },
    });
    this.stderr = new ReadableStream({
      start: (controller) => {
        this._err = controller;
      },
    });
    this.exited = new Promise<number>((resolve) => {
      this._settle = resolve;
    });
  }

  say(text: string, stream: "stdout" | "stderr" = "stdout"): void {
    const controller = stream === "stdout" ? this._out : this._err;
    controller.enqueue(new TextEncoder().encode(text));
  }

  exit(code: number): void {
    try {
      this._out.close();
      this._err.close();
    } catch {
      // Already closed by an earlier exit; harmless.
    }
    this._settle(code);
  }

  kill(signal?: number | NodeJS.Signals): void {
    this.signals.push(String(signal));
    this.exit(0);
  }
}

function definition(overrides: Partial<ResolvedDevProcess> = {}): ResolvedDevProcess {
  return {
    name: "worker",
    label: "worker",
    color: "cyan",
    argv: ["fake"],
    restart: "on-failure",
    after: "none",
    registrant: "TestProvider",
    ...overrides,
  };
}

interface Harness {
  supervisor: DevSupervisor;
  /** Every child spawned so far, in order. */
  children: FakeChild[];
  lines: Array<[string, string, string]>;
  states: Array<[string, string]>;
}

function harness(options: { backoffMs?: number[] } = {}): Harness {
  const children: FakeChild[] = [];
  const lines: Array<[string, string, string]> = [];
  const states: Array<[string, string]> = [];

  const supervisor = new DevSupervisor({
    cwd: "/app",
    backoffMs: options.backoffMs ?? [1, 1, 1],
    spawn: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    onLine: (name, line, stream) => lines.push([name, line, stream]),
    onState: (status) => states.push([status.name, status.state]),
  });

  return { supervisor, children, lines, states };
}

/** Let queued microtasks and short timers run. */
const settle = (ms = 12): Promise<void> => Bun.sleep(ms);

describe("DevSupervisor — output", () => {
  it("emits whole lines, holding a partial one until its newline arrives", async () => {
    const h = harness();
    h.supervisor.start([definition()]);
    await settle();

    h.children[0]!.say("first\nsec");
    await settle();
    expect(h.lines.map(([, line]) => line)).toEqual(["first"]);

    h.children[0]!.say("ond\n");
    await settle();
    expect(h.lines.map(([, line]) => line)).toEqual(["first", "second"]);

    await h.supervisor.stopAll();
  });

  it("marks stderr so the deck can colour it", async () => {
    const h = harness();
    h.supervisor.start([definition()]);
    await settle();

    h.children[0]!.say("boom\n", "stderr");
    await settle();

    expect(h.lines).toContainEqual(["worker", "boom", "stderr"]);
    await h.supervisor.stopAll();
  });

  it("flushes a trailing line with no newline when the process ends", async () => {
    const h = harness();
    h.supervisor.start([definition({ restart: "never" })]);
    await settle();

    h.children[0]!.say("no trailing newline");
    h.children[0]!.exit(0);
    await settle();

    expect(h.lines.map(([, line]) => line)).toContain("no trailing newline");
    await h.supervisor.stopAll();
  });
});

describe("DevSupervisor — restart policy", () => {
  it("restarts on failure", async () => {
    const h = harness();
    h.supervisor.start([definition({ restart: "on-failure" })]);
    await settle();

    h.children[0]!.exit(1);
    await settle();

    expect(h.children).toHaveLength(2);
    await h.supervisor.stopAll();
  });

  it("does not restart a clean exit under on-failure", async () => {
    const h = harness();
    h.supervisor.start([definition({ restart: "on-failure" })]);
    await settle();

    h.children[0]!.exit(0);
    await settle();

    expect(h.children).toHaveLength(1);
    expect(h.states).toContainEqual(["worker", "exited"]);
    await h.supervisor.stopAll();
  });

  it("restarts a clean exit under always", async () => {
    const h = harness();
    h.supervisor.start([definition({ restart: "always" })]);
    await settle();

    h.children[0]!.exit(0);
    await settle();

    expect(h.children).toHaveLength(2);
    await h.supervisor.stopAll();
  });

  it("never restarts under never, even on a crash", async () => {
    const h = harness();
    h.supervisor.start([definition({ restart: "never" })]);
    await settle();

    h.children[0]!.exit(1);
    await settle();

    expect(h.children).toHaveLength(1);
    expect(h.states).toContainEqual(["worker", "exited"]);
    await h.supervisor.stopAll();
  });

  it("parks after three consecutive failures and says how to recover", async () => {
    const h = harness();
    h.supervisor.start([definition()]);
    await settle();

    for (let i = 0; i < 3; i++) {
      h.children.at(-1)!.exit(1);
      await settle();
    }

    expect(h.states).toContainEqual(["worker", "parked"]);
    // Three starts, not four: the third failure parks rather than retrying.
    expect(h.children).toHaveLength(3);
    expect(h.lines.some(([, line]) => line.includes("--only=worker"))).toBe(true);

    await h.supervisor.stopAll();
  });

  it("backs off further with each attempt", async () => {
    const h = harness({ backoffMs: [30, 90, 200] });
    h.supervisor.start([definition()]);
    await settle();

    const first = Date.now();
    h.children[0]!.exit(1);
    await settle(50);
    expect(h.children).toHaveLength(2);
    expect(Date.now() - first).toBeGreaterThanOrEqual(25);

    await h.supervisor.stopAll();
  });

  it("restart() revives a parked process and resets its budget", async () => {
    const h = harness();
    h.supervisor.start([definition()]);
    await settle();

    for (let i = 0; i < 3; i++) {
      h.children.at(-1)!.exit(1);
      await settle();
    }
    expect(h.states).toContainEqual(["worker", "parked"]);

    await h.supervisor.restart("worker");
    await settle();

    expect(h.children).toHaveLength(4);
    expect(h.supervisor.statuses()[0]!.attempts).toBe(0);
    await h.supervisor.stopAll();
  });
});

describe("DevSupervisor — isolation", () => {
  it("one process crashing leaves the others running", async () => {
    const h = harness();
    h.supervisor.start([
      definition({ name: "a", label: "a" }),
      definition({ name: "b", label: "b", restart: "never" }),
    ]);
    await settle();

    // Crash `a` past its budget; `b` must be untouched.
    for (let i = 0; i < 3; i++) {
      const crashed = h.children.filter((_, index) => index !== 1).at(-1)!;
      crashed.exit(1);
      await settle();
    }

    const statuses = Object.fromEntries(h.supervisor.statuses().map((s) => [s.name, s.state]));
    expect(statuses["a"]).toBe("parked");
    expect(statuses["b"]).toBe("running");

    await h.supervisor.stopAll();
  });
});

describe("DevSupervisor — shutdown", () => {
  it("signals every running child", async () => {
    const h = harness();
    h.supervisor.start([
      definition({ name: "a", label: "a" }),
      definition({ name: "b", label: "b" }),
    ]);
    await settle();

    await h.supervisor.stopAll();

    expect(h.children).toHaveLength(2);
    for (const child of h.children) expect(child.signals).toContain("SIGTERM");
  });

  it("stays stopped — a pending retry cannot resurrect anything", async () => {
    const h = harness({ backoffMs: [40, 40, 40] });
    h.supervisor.start([definition()]);
    await settle();

    h.children[0]!.exit(1); // schedules a retry 40ms out
    await h.supervisor.stopAll();
    await settle(80);

    expect(h.children).toHaveLength(1);
  });

  it("is safe to call twice", async () => {
    const h = harness();
    h.supervisor.start([definition()]);
    await settle();

    await h.supervisor.stopAll();
    await h.supervisor.stopAll();

    expect(h.children).toHaveLength(1);
  });

  it("aborts an in-process run rather than signalling it", async () => {
    let aborted = false;
    const supervisor = new DevSupervisor({
      cwd: "/app",
      backoffMs: [1],
      spawn: () => {
        throw new Error("should not spawn for a run: process");
      },
    });

    supervisor.start([
      definition({
        argv: undefined,
        run: (signal) =>
          new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            });
          }),
      }),
    ]);
    await settle();

    await supervisor.stopAll();
    expect(aborted).toBe(true);
  });

  it("reports a spawn that throws instead of taking dev mode down", async () => {
    const lines: string[] = [];
    const supervisor = new DevSupervisor({
      cwd: "/app",
      backoffMs: [1, 1, 1],
      spawn: () => {
        throw new Error("ENOENT: no such binary");
      },
      onLine: (_name, line) => lines.push(line),
    });

    supervisor.start([definition()]);
    await settle(30);

    expect(lines.some((line) => line.includes("ENOENT"))).toBe(true);
    expect(supervisor.statuses()[0]!.state).toBe("parked");
    await supervisor.stopAll();
  });
});
