/* eslint-disable no-control-regex -- this suite is about ANSI handling: the
   regexes deliberately match ESC, which is the character the rule exists to
   flag when it appears by accident. */
/**
 * Two renderers, and the ones that matter most are the failure paths.
 *
 * Stream mode has to be readable in a file — one escape code in a piped log and
 * the mode has failed at the only job it has. Tabs mode has to give the terminal
 * back on *every* exit, including the one nobody plans for: leaving raw mode and
 * the alternate screen on makes the user's shell unusable, and it is the classic
 * way a TUI ruins someone's afternoon.
 */
import { describe, it, expect } from "bun:test";
import { createDeck, StreamDeck, TabsDeck } from "./DevDeck.ts";
import type { DeckStdin, DeckStdout } from "./DevDeck.ts";
import type { DevProcessStatus } from "./DevSupervisor.ts";
import type { OutputWriter } from "../command/OutputWriter.ts";

/** Captures everything written, so assertions read the exact bytes a terminal would. */
class CapturingWriter implements OutputWriter {
  readonly chunks: string[] = [];
  readonly lines: string[] = [];

  write(message: string): void {
    this.chunks.push(message);
  }
  writeLine(message: string): void {
    this.lines.push(message);
    this.chunks.push(message + "\n");
  }
  writeError(message: string): void {
    this.writeLine(message);
  }
  all(): string {
    return this.chunks.join("");
  }
}

function status(name: string, overrides: Partial<DevProcessStatus> = {}): DevProcessStatus {
  return { name, label: name, color: "cyan", state: "running", attempts: 0, ...overrides };
}

/** A terminal the test resizes and types into. */
function fakeTty(
  columns = 80,
  rows = 24,
): {
  stdout: DeckStdout;
  stdin: DeckStdin;
  type: (sequence: string) => void;
  resize: (columns: number, rows: number) => void;
  rawMode: boolean[];
} {
  const dataListeners: Array<(chunk: Buffer | string) => void> = [];
  const resizeListeners: Array<() => void> = [];
  const rawMode: boolean[] = [];

  const stdout: DeckStdout = {
    isTTY: true,
    columns,
    rows,
    on: (_event, listener) => resizeListeners.push(listener),
    off: (_event, listener) => {
      const index = resizeListeners.indexOf(listener);
      if (index >= 0) resizeListeners.splice(index, 1);
    },
  };

  const stdin: DeckStdin = {
    isTTY: true,
    setRawMode: (raw) => rawMode.push(raw),
    on: (_event, listener) => dataListeners.push(listener),
    off: (_event, listener) => {
      const index = dataListeners.indexOf(listener);
      if (index >= 0) dataListeners.splice(index, 1);
    },
    resume: () => {},
    pause: () => {},
  };

  return {
    stdout,
    stdin,
    type: (sequence) => dataListeners.forEach((listener) => listener(sequence)),
    resize: (nextColumns, nextRows) => {
      (stdout as { columns?: number }).columns = nextColumns;
      (stdout as { rows?: number }).rows = nextRows;
      resizeListeners.forEach((listener) => listener());
    },
    rawMode,
  };
}

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";

describe("createDeck()", () => {
  it("falls back to stream mode when stdout is not a TTY", () => {
    const deck = createDeck({
      writer: new CapturingWriter(),
      onRestart: () => {},
      onQuit: () => {},
      stdout: { isTTY: false },
      stdin: { isTTY: true },
    });

    expect(deck).toBeInstanceOf(StreamDeck);
  });

  it("falls back to stream mode when there is no stdin to read keys from", () => {
    // A tab bar nobody can switch is worse than no tab bar: it looks broken.
    const deck = createDeck({
      writer: new CapturingWriter(),
      onRestart: () => {},
      onQuit: () => {},
      stdout: { isTTY: true },
      stdin: { isTTY: false },
    });

    expect(deck).toBeInstanceOf(StreamDeck);
  });

  it("uses tabs when both halves of the terminal are there", () => {
    const tty = fakeTty();
    const deck = createDeck({
      writer: new CapturingWriter(),
      onRestart: () => {},
      onQuit: () => {},
      stdout: tty.stdout,
      stdin: tty.stdin,
    });

    expect(deck).toBeInstanceOf(TabsDeck);
    deck.stop();
  });

  it("honours an explicit mode over what the terminal supports", () => {
    const tty = fakeTty();
    const deck = createDeck({
      writer: new CapturingWriter(),
      onRestart: () => {},
      onQuit: () => {},
      mode: "stream",
      stdout: tty.stdout,
      stdin: tty.stdin,
    });

    expect(deck).toBeInstanceOf(StreamDeck);
  });
});

describe("stream mode", () => {
  it("writes plain prefixed text with no escape codes when piped", () => {
    const writer = new CapturingWriter();
    const deck = new StreamDeck(writer, false);
    deck.start([status("server"), status("queue")]);
    deck.line("queue", "processing job 12", "stdout");
    deck.line("server", "GET /", "stdout");

    expect(writer.all()).not.toMatch(/\u001b\[/);
    expect(writer.lines).toContain("[queue ] processing job 12");
    expect(writer.lines).toContain("[server] GET /");
  });

  it("keeps stderr plain too — a log file gets no colour either", () => {
    const writer = new CapturingWriter();
    const deck = new StreamDeck(writer, false);
    deck.start([status("queue")]);
    deck.line("queue", "it broke", "stderr");

    expect(writer.all()).not.toMatch(/\u001b\[/);
  });

  it("strips colour the child emitted, not just its own", () => {
    // A process spawned with a pipe often keeps colouring regardless — Zerotal's
    // own logger does — so passing it through would put escape codes in the log
    // file even though we added none.
    const writer = new CapturingWriter();
    const deck = new StreamDeck(writer, false);
    deck.start([status("queue")]);
    deck.line("queue", "\x1b[32mINFO\x1b[0m booted", "stdout");

    expect(writer.all()).not.toMatch(/\u001b\[/);
    expect(writer.lines).toContain("[queue] INFO booted");
  });

  it("leaves the child's colour alone on a real terminal", () => {
    // There it is information rather than noise, and rewriting another
    // program's output is not ours to do.
    const writer = new CapturingWriter();
    const deck = new StreamDeck(writer, true);
    deck.start([status("queue")]);
    deck.line("queue", "\x1b[32mINFO\x1b[0m booted", "stdout");

    expect(writer.all()).toContain("\x1b[32mINFO\x1b[0m booted");
  });

  it("colours output when stdout really is a terminal", () => {
    const writer = new CapturingWriter();
    const deck = new StreamDeck(writer, true);
    deck.start([status("queue")]);
    deck.line("queue", "hello", "stdout");

    expect(writer.all()).toMatch(/\x1b\[36m/);
  });

  it("pads every prefix to the widest label so the output reads as columns", () => {
    const writer = new CapturingWriter();
    const deck = new StreamDeck(writer, false);
    deck.start([status("a"), status("longest")]);
    deck.line("a", "x", "stdout");

    expect(writer.lines).toContain("[a      ] x");
  });

  it("announces a state change that is not routine", () => {
    const writer = new CapturingWriter();
    const deck = new StreamDeck(writer, false);
    deck.start([status("queue")]);
    writer.lines.length = 0;

    deck.state(status("queue", { state: "parked", exitCode: 1 }));

    expect(writer.lines.join("\n")).toContain("parked (exit 1)");
  });
});

describe("tabs mode — the terminal must survive", () => {
  it("restores the screen and leaves raw mode on a normal stop", () => {
    const tty = fakeTty();
    const writer = new CapturingWriter();
    const deck = new TabsDeck(
      { writer, onRestart: () => {}, onQuit: () => {} },
      tty.stdout,
      tty.stdin,
    );

    deck.start([status("server")]);
    expect(writer.all()).toContain(ALT_ON);
    expect(tty.rawMode).toEqual([true]);

    deck.stop();
    expect(writer.all()).toContain(ALT_OFF);
    expect(tty.rawMode).toEqual([true, false]);
  });

  it("restores the terminal when the process crashes", () => {
    // The handler registered at start() is invoked directly: an uncaught throw
    // in a test runner is not something to reproduce for real, but the path it
    // takes is exactly this one, and it is the path that ruins a shell.
    const tty = fakeTty();
    const writer = new CapturingWriter();
    const deck = new TabsDeck(
      { writer, onRestart: () => {}, onQuit: () => {} },
      tty.stdout,
      tty.stdin,
    );

    const before = process.listeners("uncaughtException").length;
    deck.start([status("server")]);
    const handlers = process.listeners("uncaughtException");
    expect(handlers.length).toBe(before + 1);

    (handlers.at(-1) as () => void)();

    expect(writer.all()).toContain(ALT_OFF);
    expect(tty.rawMode).toEqual([true, false]);
    expect(process.listeners("uncaughtException").length).toBe(before);
  });

  it("is idempotent — a signal and a quit arriving together restore once", () => {
    const tty = fakeTty();
    const writer = new CapturingWriter();
    const deck = new TabsDeck(
      { writer, onRestart: () => {}, onQuit: () => {} },
      tty.stdout,
      tty.stdin,
    );

    deck.start([status("server")]);
    deck.stop();
    deck.stop();
    deck.stop();

    expect(writer.all().split(ALT_OFF)).toHaveLength(2);
  });
});

describe("tabs mode — keys", () => {
  function mounted(names = ["server", "queue"]): {
    deck: TabsDeck;
    writer: CapturingWriter;
    tty: ReturnType<typeof fakeTty>;
    restarted: string[];
    quits: number;
  } {
    const tty = fakeTty();
    const writer = new CapturingWriter();
    const restarted: string[] = [];
    let quits = 0;
    const deck = new TabsDeck(
      {
        writer,
        onRestart: (name) => restarted.push(name),
        onQuit: () => {
          quits++;
        },
      },
      tty.stdout,
      tty.stdin,
    );
    deck.start(names.map((name) => status(name)));
    return {
      deck,
      writer,
      tty,
      restarted,
      get quits() {
        return quits;
      },
    };
  }

  it("restarts the focused process on r", () => {
    const m = mounted();
    m.tty.type("r");
    expect(m.restarted).toEqual(["server"]);

    m.tty.type("2");
    m.tty.type("r");
    expect(m.restarted).toEqual(["server", "queue"]);
    m.deck.stop();
  });

  it("quits on q and on Ctrl-C", () => {
    const m = mounted();
    m.tty.type("q");
    expect(m.quits).toBe(1);
    m.tty.type("\x03");
    expect(m.quits).toBe(2);
    m.deck.stop();
  });

  it("cycles tabs with the arrows, wrapping at both ends", () => {
    const m = mounted(["a", "b", "c"]);
    m.writer.chunks.length = 0;

    m.tty.type("\x1b[D"); // left from the first wraps to the last
    m.tty.type("r");
    expect(m.restarted).toEqual(["c"]);

    m.tty.type("\x1b[C"); // right wraps back round
    m.tty.type("r");
    expect(m.restarted).toEqual(["c", "a"]);
    m.deck.stop();
  });

  it("clears the focused tab on c without touching the others", () => {
    const m = mounted();
    m.deck.line("server", "server line", "stdout");
    m.deck.line("queue", "queue line", "stdout");

    m.tty.type("c");
    m.writer.chunks.length = 0;
    m.tty.type("2");

    expect(m.writer.all()).toContain("queue line");
    m.writer.chunks.length = 0;
    m.tty.type("1");
    expect(m.writer.all()).not.toContain("server line");
    m.deck.stop();
  });

  it("filters the focused tab while searching", () => {
    const m = mounted(["server"]);
    m.deck.line("server", "GET /users", "stdout");
    m.deck.line("server", "POST /orders", "stdout");

    m.tty.type("/");
    for (const char of "orders") m.tty.type(char);

    const painted = m.writer.all();
    expect(painted).toContain("POST /orders");
    m.writer.chunks.length = 0;

    // Escape drops the filter and the hidden line comes back.
    m.tty.type("\x1b");
    expect(m.writer.all()).toContain("GET /users");
    m.deck.stop();
  });

  it("scrolls a line at a time with the arrows", () => {
    // 24 rows is 21 lines of body, so line 30 is off the top until it is not.
    const m = mounted(["server"]);
    for (let i = 1; i <= 30; i++) m.deck.line("server", `line ${i}`, "stdout");

    m.tty.type("\x1b[A");
    m.writer.chunks.length = 0;
    m.tty.type("\x1b[A");
    expect(m.writer.all()).toContain("line 28");
    expect(m.writer.all()).not.toContain("line 30");

    m.writer.chunks.length = 0;
    m.tty.type("\x1b[B");
    m.tty.type("\x1b[B");
    expect(m.writer.all()).toContain("line 30");
    m.deck.stop();
  });

  it("scrolls on a wheel tick, which arrives as several arrows in one read", () => {
    // The terminal sends one cursor key per line scrolled, all in a single
    // chunk. Matching the chunk against a key would scroll by nothing at all.
    const m = mounted(["server"]);
    for (let i = 1; i <= 30; i++) m.deck.line("server", `line ${i}`, "stdout");
    m.writer.chunks.length = 0;

    m.tty.type("\x1b[A\x1b[A\x1b[A");

    expect(m.writer.all()).toContain("line 27");
    expect(m.writer.all()).not.toContain("line 28");
    // One tick, one frame — not one frame per line of the tick.
    expect(m.writer.chunks).toHaveLength(1);
    m.deck.stop();
  });

  it("takes SS3 arrows too, the ones application cursor mode sends", () => {
    const m = mounted(["a", "b", "c"]);

    m.tty.type("\x1bOC");
    m.tty.type("r");

    expect(m.restarted).toEqual(["b"]);
    m.deck.stop();
  });

  it("asks the terminal to send the wheel as cursor keys, and stops asking", () => {
    const m = mounted();
    expect(m.writer.all()).toContain("\x1b[?1007h");

    m.writer.chunks.length = 0;
    m.deck.stop();
    expect(m.writer.all()).toContain("\x1b[?1007l");
  });

  it("keeps a scrolled-up view on the same lines as output keeps arriving", () => {
    const m = mounted(["server"]);
    for (let i = 1; i <= 30; i++) m.deck.line("server", `line ${i}`, "stdout");
    m.tty.type("\x1b[5~"); // page up, off the bottom

    m.writer.chunks.length = 0;
    for (let i = 31; i <= 40; i++) m.deck.line("server", `line ${i}`, "stdout");
    m.tty.type("t"); // force a synchronous paint
    m.tty.type("t");

    // Whatever was on screen when the user stopped is still on screen: without
    // the anchor these ten lines would have pushed it off the top.
    expect(m.writer.all()).toContain("line 9");
    expect(m.writer.all()).not.toContain("line 31");
    m.deck.stop();
  });

  it("still follows the newest line when it was never scrolled", () => {
    const m = mounted(["server"]);
    m.deck.line("server", "first", "stdout");
    m.writer.chunks.length = 0;

    m.deck.line("server", "newest", "stdout");
    m.tty.type("1");

    expect(m.writer.all()).toContain("newest");
    m.deck.stop();
  });

  it("types two fast keystrokes as two keys, not one unknown one", () => {
    const m = mounted(["a", "b", "c"]);

    m.tty.type("3r");

    expect(m.restarted).toEqual(["c"]);
    m.deck.stop();
  });

  it("hands the terminal back when switching to stream mode", () => {
    const m = mounted();
    m.tty.type("s");

    expect(m.writer.all()).toContain(ALT_OFF);
    m.writer.chunks.length = 0;

    m.deck.line("server", "now streaming", "stdout");
    expect(m.writer.lines.join("\n")).toContain("now streaming");
    m.deck.stop();
  });
});

describe("tabs mode — buffering and layout", () => {
  it("evicts the oldest lines past the scrollback cap", () => {
    const tty = fakeTty(80, 10);
    const writer = new CapturingWriter();
    const deck = new TabsDeck(
      { writer, onRestart: () => {}, onQuit: () => {} },
      tty.stdout,
      tty.stdin,
    );
    deck.start([status("server")]);

    for (let i = 0; i < 5_200; i++) deck.line("server", `line ${i}`, "stdout");

    const cards = (deck as unknown as { _cards: Array<{ lines: string[] }> })._cards;
    expect(cards[0]!.lines).toHaveLength(5_000);
    expect(cards[0]!.lines[0]).toContain("line 200");
    deck.stop();
  });

  it("buffers a tab that is not focused instead of drawing it", () => {
    const tty = fakeTty();
    const writer = new CapturingWriter();
    const deck = new TabsDeck(
      { writer, onRestart: () => {}, onQuit: () => {} },
      tty.stdout,
      tty.stdin,
    );
    deck.start([status("server"), status("queue")]);
    writer.chunks.length = 0;

    deck.line("queue", "background work", "stdout");
    expect(writer.all()).not.toContain("background work");

    tty.type("2");
    expect(writer.all()).toContain("background work");
    deck.stop();
  });

  it("repaints at the new size on resize", () => {
    const tty = fakeTty(80, 24);
    const writer = new CapturingWriter();
    const deck = new TabsDeck(
      { writer, onRestart: () => {}, onQuit: () => {} },
      tty.stdout,
      tty.stdin,
    );
    deck.start([status("server")]);

    deck.line("server", "x".repeat(200), "stdout");
    tty.type("1"); // force a synchronous paint
    writer.chunks.length = 0;

    tty.resize(40, 12);

    const frame = writer.all();
    expect(frame).toContain("\x1b[H");
    // Every row is cut to the new width — nothing wraps and pushes the footer
    // off the bottom of the screen.
    for (const row of frame.split("\r\n")) {
      expect(
        Bun.stringWidth(row.replaceAll("\x1b[K", "").replaceAll("\x1b[J", "")),
      ).toBeLessThanOrEqual(41);
    }
    deck.stop();
  });

  it("cuts a styled line without severing its escape sequence", () => {
    const tty = fakeTty(20, 10);
    const writer = new CapturingWriter();
    const deck = new TabsDeck(
      { writer, onRestart: () => {}, onQuit: () => {} },
      tty.stdout,
      tty.stdin,
    );
    deck.start([status("server")]);

    deck.line("server", "an extremely long line that will certainly be cut", "stderr");
    tty.type("1");

    // A severed `\x1b[3` would leave the rest of the terminal painted red.
    expect(writer.all()).not.toMatch(/\x1b\[3(?![0-9]m)/);
    deck.stop();
  });
});
