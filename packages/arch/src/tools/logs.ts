/**
 * `logs` and `last_error` — the app's own trail.
 *
 * Zerotal writes a date-rotated JSON-lines file under `storage/logs` by default,
 * kept for fourteen days, and it is on whether or not anyone configured it. One
 * JSON object per line means there is nothing to parse heuristically: no
 * timestamp regex, no multi-line stack-trace reassembly, no format that changes
 * when someone edits a log template.
 *
 * Both tools read the tail of the newest files rather than the whole directory —
 * a busy app's day-file can be tens of megabytes, and the interesting entry is
 * almost always the last one.
 */
import type { ArchTool, ToolOutcome } from "../mcp/types.ts";
import type { ToolContext } from "./context.ts";

const DEFAULT_LOG_DIR = "storage/logs";
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;
/** How many day-files back to look before giving up. */
const MAX_DAYS = 14;
/** Bytes read from the end of a day-file. Generous, and bounded. */
const TAIL_BYTES = 512 * 1024;

const LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
type Level = (typeof LEVELS)[number];

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  channel?: string;
  scope?: string;
  context?: unknown;
  /**
   * Every other field on the line — `error`, `stack`, `requestId`, and whatever
   * a package writes.
   *
   * Carried wholesale rather than enumerated. Naming the six fields this tool
   * knew about meant an error entry arrived as its bare message: the framework
   * logs the exception class in `error` and the trace in `stack`, and
   * `last_error` — whose entire job is saying *why* something failed — reported
   * "Unhandled error" and dropped both. A tool that lists the fields it
   * understands will always lag the logger; passing the rest through cannot.
   */
  fields: Record<string, unknown>;
}

/**
 * Fields identical on every line from a process, so worth nothing in a report
 * and not free — this output goes into a context window.
 */
const AMBIENT = new Set([
  "level",
  "message",
  "timestamp",
  "channel",
  "scope",
  "context",
  "app",
  "env",
  "hostname",
  "pid",
]);

// ── Reading ───────────────────────────────────────────────────────────────────

/** Day-files newest first, `YYYY-MM-DD.log`. */
async function dayFiles(dir: string): Promise<string[]> {
  try {
    const files = await Array.fromAsync(new Bun.Glob("*.log").scan({ cwd: dir, onlyFiles: true }));
    return files.sort().reverse().slice(0, MAX_DAYS);
  } catch {
    return [];
  }
}

/**
 * Parse the last `TAIL_BYTES` of a JSON-lines file, oldest first.
 *
 * The first line of the window is dropped when the window did not start at the
 * beginning of the file: slicing by byte offset lands mid-line, and half an
 * entry is not an entry.
 */
export async function readTail(path: string): Promise<LogEntry[]> {
  const file = Bun.file(path);
  const size = file.size;
  const from = Math.max(0, size - TAIL_BYTES);
  const text = await (from > 0 ? file.slice(from).text() : file.text());

  const lines = text.split("\n");
  if (from > 0) lines.shift();

  const entries: LogEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null) continue;
      const record = parsed as Record<string, unknown>;
      if (typeof record["message"] !== "string") continue;

      const fields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (!AMBIENT.has(key) && value !== undefined) fields[key] = value;
      }

      entries.push({
        level: typeof record["level"] === "string" ? record["level"] : "info",
        message: record["message"],
        timestamp: typeof record["timestamp"] === "string" ? record["timestamp"] : "",
        ...(typeof record["channel"] === "string" ? { channel: record["channel"] } : {}),
        ...(typeof record["scope"] === "string" ? { scope: record["scope"] } : {}),
        ...(record["context"] !== undefined ? { context: record["context"] } : {}),
        fields,
      });
    } catch {
      /* a truncated or hand-edited line is skipped, not fatal */
    }
  }
  return entries;
}

/**
 * Walk day-files newest-first, collecting entries that pass `keep`, until
 * `limit` of them are found.
 *
 * Returned oldest-first, because that is the order a reader follows a story in.
 */
async function collect(
  dir: string,
  limit: number,
  keep: (entry: LogEntry) => boolean,
): Promise<{ entries: LogEntry[]; scanned: number }> {
  const found: LogEntry[] = [];
  const files = await dayFiles(dir);

  for (const file of files) {
    const day = (await readTail(`${dir}/${file}`)).filter(keep);
    // Newest first across files, so take from the end of each day.
    found.unshift(...day.slice(Math.max(0, day.length - (limit - found.length))));
    if (found.length >= limit) break;
  }

  return { entries: found, scanned: files.length };
}

function levelFilter(raw: unknown): (entry: LogEntry) => boolean {
  const requested = typeof raw === "string" ? raw.toLowerCase() : undefined;
  if (requested === undefined || !(LEVELS as readonly string[]).includes(requested)) {
    return () => true;
  }
  // A level is a floor, not an equality: asking for `warn` and being handed no
  // errors would be the opposite of useful.
  const floor = LEVELS.indexOf(requested as Level);
  return (entry) => {
    const at = LEVELS.indexOf(entry.level.toLowerCase() as Level);
    return at === -1 ? true : at >= floor;
  };
}

function clampLimit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

/**
 * Render one entry.
 *
 * `stack` is included only when asked for. `last_error` returns a single entry
 * and the trace is the answer; `logs` can return two hundred, and a trace on
 * each would bury the sequence the caller asked to see under its own detail.
 */
function renderEntry(entry: LogEntry, options: { stack?: boolean } = {}): string {
  const scope = entry.scope ? ` [${entry.scope}]` : "";
  const lines = [`${entry.timestamp} ${entry.level.toUpperCase()}${scope} ${entry.message}`];

  const { error, stack, requestId, ...rest } = entry.fields as {
    error?: unknown;
    stack?: unknown;
    requestId?: unknown;
  } & Record<string, unknown>;

  // The exception first: for an error entry it is the thing being reported, and
  // `message` is often only the generic "Unhandled error" wrapping it.
  if (typeof error === "string" && error !== entry.message) lines.push(`    error: ${error}`);
  if (typeof requestId === "string") lines.push(`    request: ${requestId}`);
  if (entry.context !== undefined) lines.push(`    ${JSON.stringify(entry.context)}`);

  const extra = Object.entries(rest).filter(([, value]) => value !== undefined);
  if (extra.length > 0) lines.push(`    ${JSON.stringify(Object.fromEntries(extra))}`);

  if (options.stack && typeof stack === "string") {
    lines.push(...stack.split("\n").map((line) => `    ${line.trim()}`));
  }

  return lines.join("\n");
}

const noTrail = (dir: string): string =>
  `No log trail at ${dir}. Zerotal writes one by default outside tests — an empty directory ` +
  `usually means the app has not run yet, or logging.file is set to false in config/logging.ts.`;

// ── Tools ─────────────────────────────────────────────────────────────────────

export function logsTool(ctx: ToolContext): ArchTool {
  return {
    name: "logs",
    title: "Logs",
    description:
      "Read this app's recent log entries from its on-disk trail. Each entry carries a level, " +
      "timestamp, scope and structured context. Pass `level` to set a floor — `warn` returns " +
      "warnings, errors and fatals. Use it to find out what an app actually did, rather than " +
      "inferring it from the code.",
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: [...LEVELS],
          description: "Minimum level to include. Omit for everything.",
        },
        contains: {
          type: "string",
          description: "Only entries whose message contains this, case-insensitively.",
        },
        limit: {
          type: "number",
          description: `How many entries. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        total: { type: "number" },
        entries: { type: "array", items: { $ref: "#/$defs/entry" } },
      },
      required: ["total", "entries"],
      $defs: { entry: entrySchema() },
    },

    async run(args): Promise<ToolOutcome> {
      const dir = `${ctx.root}/${DEFAULT_LOG_DIR}`;
      const byLevel = levelFilter(args["level"]);
      const needle =
        typeof args["contains"] === "string" ? args["contains"].toLowerCase() : undefined;

      const { entries, scanned } = await collect(
        dir,
        clampLimit(args["limit"]),
        (entry) =>
          byLevel(entry) && (needle === undefined || entry.message.toLowerCase().includes(needle)),
      );

      if (scanned === 0) return { text: noTrail(dir), failed: true };
      if (entries.length === 0) {
        return {
          text: `No matching entries in the last ${scanned} day-file(s).`,
          data: { total: 0, entries: [] },
        };
      }

      return {
        text: entries.map((entry) => renderEntry(entry)).join("\n"),
        data: { total: entries.length, entries },
      };
    },
  };
}

export function lastErrorTool(ctx: ToolContext): ArchTool {
  return {
    name: "last_error",
    title: "Last error",
    description:
      "The most recent error or fatal entry in this app's log trail, with its full context. " +
      "The fastest way to find out why something failed — call it before reading code to guess.",
    inputSchema: { type: "object", additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        found: { type: "boolean" },
        entry: entrySchema(),
      },
      required: ["found"],
    },

    async run(): Promise<ToolOutcome> {
      const dir = `${ctx.root}/${DEFAULT_LOG_DIR}`;
      const isError = (entry: LogEntry): boolean => {
        const level = entry.level.toLowerCase();
        return level === "error" || level === "fatal";
      };

      const { entries, scanned } = await collect(dir, 1, isError);
      if (scanned === 0) return { text: noTrail(dir), failed: true };

      const entry = entries[entries.length - 1];
      if (!entry) {
        return {
          text: `No error has been logged in the last ${scanned} day-file(s).`,
          data: { found: false },
        };
      }

      // The trace is the answer here, so it is included.
      return { text: renderEntry(entry, { stack: true }), data: { found: true, entry } };
    },
  };
}

function entrySchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      level: { type: "string" },
      message: { type: "string" },
      timestamp: { type: "string" },
      channel: { type: "string" },
      scope: { type: "string" },
      context: {},
      fields: {
        type: "object",
        description:
          "Everything else the logger recorded on this line — `error` and `stack` on an " +
          "exception, `requestId` to correlate it with a request, and whatever a package adds.",
        additionalProperties: true,
      },
    },
    required: ["level", "message", "timestamp", "fields"],
  };
}
