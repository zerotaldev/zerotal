/**
 * The Deck — a deck of tabs, one card per dev process.
 *
 * Two renderers sit behind one interface. **Stream** interleaves every process's
 * output as `[label] line`, plain text, no escape codes; **tabs** draws a real
 * terminal UI with a tab bar and per-process scrollback. Stream is not a
 * degraded fallback bolted on afterwards — it is the honest base case, the thing
 * you want in a log file or CI, and it is chosen automatically whenever stdout
 * is not a TTY. Tabs is a layer on top of it.
 *
 * ## Why we built this rather than pulling one in
 *
 * `@zerotal/core` carries exactly one external runtime dependency. A terminal
 * multiplexer off npm would be the second, in the package every other one
 * depends on, to draw a box. Bun ships every primitive this needs — column width
 * that understands escapes (`Bun.stringWidth`), slicing that does not cut one in
 * half (`Bun.sliceAnsi`), terminal size and resize events, and raw stdin.
 *
 * ## The terminal must survive us
 *
 * Raw mode plus the alternate screen left on is the classic TUI bug: the shell
 * comes back with no echo, no line editing, and no shell scrollback. The restore is
 * therefore registered *before* raw mode is entered, and it runs on every exit
 * path there is — `q`, a signal, and an uncaught throw. It is also idempotent,
 * because several of those can happen at once.
 *
 * ## Scrolling is ours to do
 *
 * The alternate screen has no scrollback of its own, so the terminal's scrollbar
 * and wheel have nothing to move: from the moment tabs mode starts, every way of
 * looking at an older line has to come from here. Each card keeps its own buffer
 * and its own position in it, the wheel arrives as cursor keys, and a card that
 * has been scrolled up holds its place while the process behind it keeps
 * printing.
 */
import type { OutputWriter } from "../command/OutputWriter.ts";
import type { DevProcessColor } from "./DevProcess.ts";
import type { DevProcessStatus } from "./DevSupervisor.ts";

/** What the dev command drives, whichever renderer is behind it. */
export interface Deck {
  /** Draw the initial frame for these processes. */
  start(statuses: DevProcessStatus[]): void;
  /** One line of output from a process. */
  line(name: string, text: string, stream: "stdout" | "stderr"): void;
  /** A process changed state. */
  state(status: DevProcessStatus): void;
  /** A message from dev mode itself, not from any one process. */
  notice(text: string): void;
  /** Restore the terminal. Idempotent, and safe to call from a signal handler. */
  stop(): void;
}

export interface DeckOptions {
  writer: OutputWriter;
  /** Restart the named process — bound to `r`. */
  onRestart: (name: string) => void;
  /** The user asked to quit — bound to `q`. */
  onQuit: () => void;
  /** Force a renderer. Defaults to tabs on a TTY, stream otherwise. */
  mode?: "tabs" | "stream";
  /** Overridable for tests. Defaults to `process.stdout`/`process.stdin`. */
  stdout?: DeckStdout;
  stdin?: DeckStdin;
}

/** The bits of `process.stdout` the deck reads. */
export interface DeckStdout {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  on?(event: "resize", listener: () => void): unknown;
  off?(event: "resize", listener: () => void): unknown;
}

/** The bits of `process.stdin` the deck reads. */
export interface DeckStdin {
  isTTY?: boolean;
  setRawMode?(raw: boolean): unknown;
  on?(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off?(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  resume?(): unknown;
  pause?(): unknown;
}

/**
 * Pick a renderer.
 *
 * Tabs needs both halves of a terminal: somewhere to draw *and* somewhere to
 * read keys from. A process with a TTY on stdout but not stdin (some CI
 * runners, `zt dev < /dev/null`) would render a tab bar nobody could ever
 * switch, so it gets stream instead.
 */
export function createDeck(options: DeckOptions): Deck {
  const stdout = options.stdout ?? process.stdout;
  const stdin = options.stdin ?? process.stdin;
  const wantsTabs = options.mode ? options.mode === "tabs" : Boolean(stdout.isTTY && stdin.isTTY);
  return wantsTabs
    ? new TabsDeck(options, stdout, stdin)
    : new StreamDeck(options.writer, Boolean(stdout.isTTY));
}

// ── Stream mode ───────────────────────────────────────────────────────────────

/**
 * Interleaved, prefixed, one line at a time.
 *
 * Colour is applied only when stdout is a terminal. Piped to a file this emits
 * nothing but text, which is the point — a log with escape codes in it is a log
 * you have to clean before you can read it.
 */
export class StreamDeck implements Deck {
  private _width = 0;
  private readonly _colors = new Map<string, DevProcessColor>();

  constructor(
    private readonly _writer: OutputWriter,
    private readonly _color: boolean,
  ) {}

  start(statuses: DevProcessStatus[]): void {
    for (const status of statuses) this._colors.set(status.name, status.color);
    // Pad every prefix to the same width so the output reads as columns rather
    // than a ragged left edge that shifts whenever a different process speaks.
    this._width = Math.max(0, ...statuses.map((status) => status.label.length));
    for (const status of statuses) this.state(status);
  }

  line(name: string, text: string, stream: "stdout" | "stderr"): void {
    const prefix = this._prefix(name);
    // Strip the *child's* colour too when this is not a terminal. A process
    // spawned with a pipe often keeps colouring anyway (Zerotal's own logger
    // does), and a log file full of escape codes is one you have to clean before
    // you can read it. On a real terminal it passes through untouched — there it
    // is information, not noise.
    const body = this._color ? text : _stripAnsi(text);
    this._writer.writeLine(
      `${prefix} ${this._color && stream === "stderr" ? _paint(body, "red") : body}`,
    );
  }

  state(status: DevProcessStatus): void {
    this._colors.set(status.name, status.color);
    if (status.state === "starting" || status.state === "running") return;
    const detail = status.exitCode === undefined ? "" : ` (exit ${status.exitCode})`;
    this._writer.writeLine(`${this._prefix(status.name)} ${status.state}${detail}`);
  }

  notice(text: string): void {
    this._writer.writeLine(`${this._pad("zerotal")} ${text}`);
  }

  stop(): void {
    // Nothing was taken over, so there is nothing to give back.
  }

  private _prefix(name: string): string {
    const label = this._pad(name);
    const color = this._colors.get(name);
    return this._color && color ? _paint(label, color) : label;
  }

  private _pad(label: string): string {
    return `[${label.padEnd(this._width)}]`;
  }
}

// ── Tabs mode ─────────────────────────────────────────────────────────────────

/** Lines kept per process. Beyond this the oldest are dropped. */
const SCROLLBACK = 5_000;
/** Repaints are coalesced to roughly one animation frame. */
const REPAINT_MS = 16;

/** One process's card in the deck. */
interface Card {
  status: DevProcessStatus;
  /** Ring buffer of rendered lines, oldest first. */
  lines: string[];
  /** Lines scrolled up from the bottom. 0 means pinned to the newest line. */
  scroll: number;
}

export class TabsDeck implements Deck {
  private readonly _cards: Card[] = [];
  private readonly _index = new Map<string, Card>();
  private _focused = 0;
  private _search = "";
  private _searching = false;
  private _timestamps = false;
  private _streaming = false;
  private _repaintTimer: ReturnType<typeof setTimeout> | undefined;
  private _restored = false;
  private _stream: StreamDeck | undefined;

  private readonly _onData = (chunk: Buffer | string): void => this._input(chunk.toString());
  private readonly _onResize = (): void => this._paint();
  private readonly _onExit = (): void => this.stop();

  constructor(
    private readonly _options: DeckOptions,
    private readonly _stdout: DeckStdout,
    private readonly _stdin: DeckStdin,
  ) {}

  start(statuses: DevProcessStatus[]): void {
    for (const status of statuses) {
      const card: Card = { status, lines: [], scroll: 0 };
      this._cards.push(card);
      this._index.set(status.name, card);
    }

    // Registered *before* the terminal is taken over, so a throw between here
    // and the first paint still gives the shell back.
    process.on("exit", this._onExit);
    process.on("uncaughtException", this._onExit);
    process.on("unhandledRejection", this._onExit);

    this._write(ALT_SCREEN_ON + CURSOR_HIDE + ALT_SCROLL_ON);
    this._stdin.setRawMode?.(true);
    this._stdin.resume?.();
    this._stdin.on?.("data", this._onData);
    this._stdout.on?.("resize", this._onResize);

    this._paint();
  }

  line(name: string, text: string, stream: "stdout" | "stderr"): void {
    const card = this._index.get(name);
    if (!card) return;

    const stamp = _clock();
    const body = stream === "stderr" ? _paint(text, "red") : text;
    card.lines.push(`${stamp} ${body}`);
    if (card.lines.length > SCROLLBACK) card.lines.shift();
    this._anchor(card, body);

    // A tab the user is not looking at still buffers; only the visible one costs
    // a repaint. In stream mode every line prints regardless of focus.
    if (this._streaming) this._stream?.line(name, text, stream);
    else if (this._cards[this._focused] === card) this._schedulePaint();
  }

  state(status: DevProcessStatus): void {
    const card = this._index.get(status.name);
    if (!card) return;
    card.status = status;
    if (this._streaming) this._stream?.state(status);
    else this._schedulePaint();
  }

  notice(text: string): void {
    if (this._streaming) {
      this._stream?.notice(text);
      return;
    }
    const card = this._cards[this._focused];
    if (!card) return;
    card.lines.push(`${_clock()} ${_paint(text, "yellow")}`);
    this._schedulePaint();
  }

  stop(): void {
    if (this._restored) return;
    this._restored = true;

    // Dropped here rather than left as one-shots: a deck that has given the
    // terminal back has no business still holding process-wide handlers, and in
    // a long-lived process (or a test suite) they would accumulate.
    process.off("exit", this._onExit);
    process.off("uncaughtException", this._onExit);
    process.off("unhandledRejection", this._onExit);

    this._stdin.off?.("data", this._onData);
    this._stdout.off?.("resize", this._onResize);
    try {
      this._stdin.setRawMode?.(false);
    } catch {
      // stdin may already be closed during shutdown; the alt-screen exit below
      // is the part that actually matters to the user's shell.
    }
    this._stdin.pause?.();
    if (this._repaintTimer) clearTimeout(this._repaintTimer);
    this._write(ALT_SCROLL_OFF + CURSOR_SHOW + ALT_SCREEN_OFF);
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  /**
   * One read from stdin, which is not the same thing as one key.
   *
   * A wheel tick arrives as the same arrow sequence repeated as many times as
   * there are lines to scroll, all in a single read, and two fast keystrokes
   * arrive together — so a chunk is split into keys first and the frame is
   * painted once at the end rather than once per key.
   */
  private _input(chunk: string): void {
    let dirty = false;
    for (const key of _keys(chunk)) dirty = this._key(key) || dirty;
    if (dirty) this._paint();
  }

  /** Handle one key. Returns whether the frame needs repainting. */
  private _key(sequence: string): boolean {
    if (this._searching) return this._searchKey(sequence);

    switch (sequence) {
      case "q":
      case "\x03": // Ctrl-C — the deck owns the terminal, so it owns the quit.
        this._options.onQuit();
        return false;
      case "r": {
        const card = this._cards[this._focused];
        if (card) this._options.onRestart(card.status.name);
        return false;
      }
      case "c": {
        const card = this._cards[this._focused];
        if (card) {
          card.lines.length = 0;
          card.scroll = 0;
        }
        break;
      }
      case "/":
        this._searching = true;
        this._search = "";
        break;
      case "s":
        this._toggleStream();
        return false;
      case "t":
        this._timestamps = !this._timestamps;
        break;
      case "\t":
      case ARROW_RIGHT:
        this._focus(this._focused + 1);
        break;
      case ARROW_LEFT:
        this._focus(this._focused - 1);
        break;
      // The wheel is these two: in the alternate screen a terminal has no
      // scrollback to move, so it sends the cursor keys instead (which is what
      // `ALT_SCROLL_ON` asks for). Ignoring them is what makes the deck look
      // like a terminal that will not scroll.
      case ARROW_UP:
        this._scroll(1);
        break;
      case ARROW_DOWN:
        this._scroll(-1);
        break;
      case PAGE_UP:
        this._scroll(this._bodyHeight());
        break;
      case PAGE_DOWN:
        this._scroll(-this._bodyHeight());
        break;
      case HOME:
        this._scroll(Number.MAX_SAFE_INTEGER);
        break;
      case END:
        this._scroll(-Number.MAX_SAFE_INTEGER);
        break;
      default: {
        if (sequence >= "1" && sequence <= "9") this._focus(Number(sequence) - 1);
        else return false;
      }
    }

    return true;
  }

  /** Handle one key while the search box has the keyboard. Always repaints. */
  private _searchKey(sequence: string): boolean {
    if (sequence === "\r" || sequence === "\n" || sequence === "\x1b") {
      // Enter keeps the filter and hands the keyboard back; Escape drops it.
      this._searching = false;
      if (sequence === "\x1b") this._search = "";
    } else if (sequence === "\x7f" || sequence === "\b") {
      this._search = this._search.slice(0, -1);
    } else if (sequence === "\x03") {
      this._searching = false;
      this._search = "";
    } else if (!sequence.startsWith("\x1b")) {
      this._search += sequence;
    }

    const card = this._cards[this._focused];
    if (card) card.scroll = 0;
    return true;
  }

  private _focus(index: number): void {
    if (this._cards.length === 0) return;
    const count = this._cards.length;
    this._focused = ((index % count) + count) % count;
    this._search = "";
  }

  private _scroll(by: number): void {
    const card = this._cards[this._focused];
    if (!card) return;
    const max = Math.max(0, this._visibleLines(card).length - this._bodyHeight());
    card.scroll = Math.min(max, Math.max(0, card.scroll + by));
  }

  /**
   * Hold a scrolled-up view on the lines it was left on.
   *
   * `scroll` counts lines up from the newest, so a busy process would otherwise
   * drag the window down by one line for every line it printed and the text
   * somebody stopped to read would slide off the top while they read it. A card
   * pinned to the bottom (`scroll === 0`) is left alone — that one *should*
   * follow the output.
   */
  private _anchor(card: Card, appended: string): void {
    if (card.scroll === 0) return;
    // Only the focused card is ever filtered — `_focus()` clears the search —
    // so only there can an arriving line be invisible and move nothing.
    const needle = this._cards[this._focused] === card ? this._search.toLowerCase() : "";
    const visible = !needle || appended.toLowerCase().includes(needle);
    // Unfiltered, the count is the buffer's own — worth the branch, because this
    // runs once per line of output and the buffer holds thousands.
    const total = needle ? this._visibleLines(card).length : card.lines.length;
    // Clamped even when nothing was added: at the scrollback cap every new line
    // evicts an old one, and without this the view would walk off the top.
    card.scroll = Math.min(
      card.scroll + (visible ? 1 : 0),
      Math.max(0, total - this._bodyHeight()),
    );
  }

  /**
   * Hand the terminal back and print plainly from here on.
   *
   * The buffered scrollback is deliberately *not* replayed: the user pressed `s`
   * to watch what happens next, and dumping several thousand buffered lines
   * first would bury it.
   */
  private _toggleStream(): void {
    this._streaming = !this._streaming;
    if (this._streaming) {
      this.stop();
      this._restored = false; // stop() may still need to run again on quit.
      this._stream = new StreamDeck(this._options.writer, Boolean(this._stdout.isTTY));
      this._stream.start(this._cards.map((card) => card.status));
      this._stream.notice("stream mode — press Ctrl-C to quit");
      return;
    }
    this._stream = undefined as StreamDeck | undefined;
    this._write(ALT_SCREEN_ON + CURSOR_HIDE + ALT_SCROLL_ON);
    this._stdin.setRawMode?.(true);
    this._paint();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _schedulePaint(): void {
    if (this._repaintTimer) return;
    this._repaintTimer = setTimeout(() => {
      this._repaintTimer = undefined as ReturnType<typeof setTimeout> | undefined;
      this._paint();
    }, REPAINT_MS);
  }

  private _columns(): number {
    return Math.max(20, this._stdout.columns ?? 80);
  }

  private _rows(): number {
    return Math.max(6, this._stdout.rows ?? 24);
  }

  /** Rows available for process output: everything but the tab bar, rule, and footer. */
  private _bodyHeight(): number {
    return Math.max(1, this._rows() - 3);
  }

  private _paint(): void {
    if (this._streaming || this._restored) return;

    const width = this._columns();
    const rows: string[] = [this._tabBar(width), _paint("─".repeat(width), "dim")];

    const card = this._cards[this._focused];
    const height = this._bodyHeight();
    if (card) {
      const lines = this._visibleLines(card);
      const end = Math.max(0, lines.length - card.scroll);
      const window = lines.slice(Math.max(0, end - height), end);
      for (const line of window) rows.push(_fit(line, width));
      for (let i = window.length; i < height; i++) rows.push("");
    }

    rows.push(this._footer(width));

    // One write, not one per row: a repaint split across writes tears visibly on
    // a slow terminal. `\x1b[K` clears each line's tail so a shorter line does
    // not leave the previous frame's characters behind it.
    this._write(CURSOR_HOME + rows.map((row) => row + CLEAR_LINE).join("\r\n") + CLEAR_BELOW);
  }

  private _tabBar(width: number): string {
    const cells = this._cards.map((card, index) => {
      const glyph = STATE_GLYPH[card.status.state];
      const text = ` ${index + 1} ${card.status.label} ${glyph} `;
      if (index === this._focused) return _invert(_paint(text, card.status.color));
      return _paint(text, card.status.color);
    });
    return _fit(cells.join(_paint("│", "dim")), width);
  }

  private _footer(width: number): string {
    if (this._searching) return _fit(_paint(`/${this._search}`, "yellow"), width);

    const card = this._cards[this._focused];
    const scrolled = card && card.scroll > 0 ? `  ↑${card.scroll}` : "";
    const filtered = this._search ? `  /${this._search}` : "";
    const keys =
      "1-9 tab · ←/→ cycle · ↑/↓ scroll · r restart · c clear · / search · t time · s stream · q quit";
    return _fit(_paint(keys + filtered + scrolled, "dim"), width);
  }

  /** The focused card's lines, with the search filter and timestamp toggle applied. */
  private _visibleLines(card: Card): string[] {
    const needle = this._search.toLowerCase();
    const out: string[] = [];
    for (const entry of card.lines) {
      const split = entry.indexOf(" ");
      const stamp = entry.slice(0, split);
      const body = entry.slice(split + 1);
      if (needle && !body.toLowerCase().includes(needle)) continue;
      out.push(this._timestamps ? `${_paint(stamp, "dim")} ${body}` : body);
    }
    return out;
  }

  private _write(text: string): void {
    this._options.writer.write(text);
  }
}

// ── Terminal primitives ───────────────────────────────────────────────────────

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const CURSOR_HOME = "\x1b[H";
const CLEAR_LINE = "\x1b[K";
const CLEAR_BELOW = "\x1b[J";

/**
 * Alternate scroll: ask the terminal to send cursor keys when the wheel turns.
 *
 * On the alternate screen there is no scrollback for the wheel to move, so
 * without this the wheel does nothing at all and the deck reads as frozen.
 * Most terminals do it by default, some do not, and asking costs one sequence.
 * Deliberately *not* mouse tracking (`?1000h` and friends), which would hand us
 * real wheel events at the price of the terminal's own text selection.
 */
const ALT_SCROLL_ON = "\x1b[?1007h";
const ALT_SCROLL_OFF = "\x1b[?1007l";

const ARROW_UP = "\x1b[A";
const ARROW_DOWN = "\x1b[B";
const ARROW_LEFT = "\x1b[D";
const ARROW_RIGHT = "\x1b[C";
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";
const HOME = "\x1b[H";
const END = "\x1b[F";

/** A CSI sequence ends at the first byte in this range; everything before is parameters. */
const _CSI_END = /[@-~]/;

/**
 * Split one read from stdin into individual key presses.
 *
 * SS3 arrows (`ESC O A`, what a terminal in application cursor mode sends) are
 * rewritten to their CSI spelling so the switch upstairs only has to know one
 * form of each key, and text is walked by code point so that an emoji typed
 * into the search box stays one key rather than two broken halves.
 */
function _keys(chunk: string): string[] {
  const out: string[] = [];
  let at = 0;

  while (at < chunk.length) {
    if (chunk[at] !== "\x1b") {
      const point = String.fromCodePoint(chunk.codePointAt(at)!);
      out.push(point);
      at += point.length;
      continue;
    }

    const next = chunk[at + 1];
    if (next === "[") {
      let end = at + 2;
      while (end < chunk.length && !_CSI_END.test(chunk[end]!)) end++;
      // A sequence cut off by the end of the read is passed through whole
      // rather than split into an Escape and some letters, which is what would
      // type `[` and `A` into the search box.
      out.push(chunk.slice(at, end + 1));
      at = end + 1;
    } else if (next === "O" && at + 2 < chunk.length) {
      out.push(`\x1b[${chunk[at + 2]}`);
      at += 3;
    } else {
      out.push("\x1b"); // A bare Escape — the key, not the start of anything.
      at += 1;
    }
  }

  return out;
}

const STATE_GLYPH: Record<DevProcessStatus["state"], string> = {
  starting: "◌",
  running: "●",
  restarting: "◍",
  exited: "○",
  parked: "✗",
};

const ANSI: Record<DevProcessColor | "dim", string> = {
  cyan: "36",
  magenta: "35",
  yellow: "33",
  green: "32",
  blue: "34",
  red: "31",
  dim: "2",
};

/**
 * Remove SGR escape sequences, for output going somewhere that cannot render
 * them. Deliberately narrow: colour and style only, so a sequence that means
 * something structural is left alone rather than half-understood.
 */
// eslint-disable-next-line no-control-regex -- the escape byte is the pattern.
const _SGR = /\x1b\[[0-9;]*m/g;

function _stripAnsi(text: string): string {
  return text.replace(_SGR, "");
}

function _paint(text: string, color: DevProcessColor | "dim"): string {
  return `\x1b[${ANSI[color]}m${text}\x1b[0m`;
}

function _invert(text: string): string {
  return `\x1b[7m${text}\x1b[0m`;
}

/**
 * Cut a styled string to `width` columns.
 *
 * `Bun.stringWidth` measures what the terminal will actually show — escape
 * sequences are zero-width, and a CJK character or an emoji is two columns — and
 * `Bun.sliceAnsi` cuts without severing an escape sequence, which is what turns
 * the rest of the screen a colour it was never meant to be.
 */
function _fit(text: string, width: number): string {
  return Bun.stringWidth(text) <= width ? text : Bun.sliceAnsi(text, 0, width);
}

/** `HH:MM:SS` for the timestamp gutter. */
function _clock(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
