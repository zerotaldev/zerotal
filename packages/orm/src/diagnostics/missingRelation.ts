/**
 * "no such table: assets", answered.
 *
 * The message is exact and the stack is useless — every frame is inside the SQL
 * driver, because that is where the failure surfaces, not where it comes from.
 * The answer is almost always "you have migrations you have not run", and that
 * lives here, one package away from the error page that needs it.
 *
 * The half that earns this feature is refusing to offer the button when it would
 * not help. There are two situations and they need different answers: a table
 * missing because a migration is pending, and a table missing because nobody ever
 * wrote one. Running every pending migration in the second case changes nothing,
 * leaves the developer where they started, and teaches them not to trust the
 * panel.
 */
import type { ErrorDiagnosis } from "@zerotal/core";
import { loadMigrations } from "../commands/_loadMigrations.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import type { MigrationEntry } from "../schema/MigrationRunner.ts";
import { _getConnection } from "../db/DB.ts";

/** What the database said is missing. */
export interface MissingRelation {
  kind: "table" | "column";
  name: string;
}

/** Dialect error codes, checked before the message text. */
const CODES: Record<string, MissingRelation["kind"]> = {
  // PostgreSQL SQLSTATE
  "42P01": "table", // undefined_table
  "42703": "column", // undefined_column
  // MySQL
  "1146": "table", // ER_NO_SUCH_TABLE
  "1054": "column", // ER_BAD_FIELD_ERROR
  ER_NO_SUCH_TABLE: "table",
  ER_BAD_FIELD_ERROR: "column",
};

/**
 * Message shapes, as a fallback.
 *
 * SQLite has no error code worth branching on — everything arrives as
 * `SQLITE_ERROR` — so its two messages are matched directly. Postgres and MySQL
 * are matched by code above; their text is included because a driver that wraps
 * the error can drop the code while keeping the message.
 */
const PATTERNS: Array<{ re: RegExp; kind: MissingRelation["kind"] }> = [
  // Each captures the whole identifier — quotes, schema qualifier and all — and
  // leaves the tidying to `bareName`. Capturing only the last segment needs a
  // lazy qualifier prefix, and getting that subtly wrong is how `app.assets`
  // came back as an empty name.
  { re: /no such table:\s*([\w".`]+)/i, kind: "table" },
  { re: /no such column:\s*([\w".`]+)/i, kind: "column" },
  { re: /relation\s+([\w".]+)\s+does not exist/i, kind: "table" },
  { re: /column\s+([\w".]+)\s+does not exist/i, kind: "column" },
  { re: /table\s+'([\w.]+)'\s+doesn'?t exist/i, kind: "table" },
  { re: /unknown column\s+'([\w.]+)'/i, kind: "column" },
];

/** Strip a qualifier and quoting: `"public"."assets"` → `assets`. */
function bareName(raw: string): string {
  const parts = raw.replace(/["`']/g, "").split(".");
  return parts[parts.length - 1] ?? raw;
}

/**
 * Whether this error is a database complaining about something that is not there.
 *
 * Returns `null` for everything else, including every other database error — a
 * diagnoser that recognises errors it does not own is worse than none.
 */
export function detectMissingRelation(error: Error): MissingRelation | null {
  const message = error.message ?? "";

  // Code first: it is unambiguous where it exists, and message text is localised
  // on some MySQL builds.
  const code = (error as { code?: string | number; errno?: number }).code;
  const errno = (error as { errno?: number }).errno;
  const kindFromCode = CODES[String(code)] ?? CODES[String(errno)];

  for (const { re, kind } of PATTERNS) {
    const match = re.exec(message);
    if (match?.[1]) return { kind: kindFromCode ?? kind, name: bareName(match[1]) };
  }

  // A recognised code with an unrecognised message still tells us the kind, but
  // not the name — worth reporting, because "some table is missing" plus the
  // pending list is still the answer.
  if (kindFromCode) return { kind: kindFromCode, name: "" };
  return null;
}

/** Migrations that exist on disk and have not run. */
export async function pendingMigrations(): Promise<string[]> {
  const records = await loadMigrations();
  if (records.length === 0) return [];
  const entries: MigrationEntry[] = records.map((r) => ({ name: r.name, migration: r.instance }));
  const runner = new MigrationRunner({ connection: _getConnection() });
  const statuses = await runner.status(entries);
  return statuses.filter((s) => !s.ran).map((s) => s.name);
}

/**
 * Does any migration on disk so much as mention this name?
 *
 * A weak signal used only to sharpen the message in the nothing-pending case:
 * "no migration mentions `assets`" is a better sentence than anything generic,
 * and it is usually right, because a migration that creates a table names it.
 */
async function anyMigrationMentions(name: string): Promise<boolean> {
  if (name === "") return false;
  const glob = new Bun.Glob("database/migrations/*.ts");
  for await (const file of glob.scan({ cwd: process.cwd() })) {
    try {
      const source = await Bun.file(file).text();
      if (source.includes(name)) return true;
    } catch {
      // Unreadable file — treat as no evidence rather than failing the diagnosis.
    }
  }
  return false;
}

/**
 * Build the diagnosis, given a token minter for the action.
 *
 * `mintToken` is passed in rather than imported so this stays testable without a
 * running server, and so the endpoint owns its own token lifetime.
 */
export async function diagnoseMissingRelation(
  error: Error,
  options: { endpoint: string; mintToken: () => string },
): Promise<ErrorDiagnosis | null> {
  const missing = detectMissingRelation(error);
  if (!missing) return null;

  const subject = missing.name === "" ? `A ${missing.kind}` : `${missing.kind} \`${missing.name}\``;

  let pending: string[];
  try {
    pending = await pendingMigrations();
  } catch {
    // No connection, no migrations directory, a driver that cannot answer — the
    // detection still stands, so say what is missing without guessing why.
    return {
      title: `${subject} does not exist.`,
      detail:
        "The migration state could not be read, so this cannot say whether a pending " +
        "migration would create it. Run `bun zt migrate:status` to see where things stand.",
    };
  }

  if (pending.length > 0) {
    return {
      title: `${subject} does not exist, and ${pending.length} migration${
        pending.length === 1 ? " has" : "s have"
      } not run.`,
      detail:
        "Running them is very likely the fix. This runs the same migrations " +
        "`bun zt migrate` would, in the same order, against the same connection — " +
        "and it is available here only because the app is in development.",
      items: pending,
      action: {
        label: `Run ${pending.length} migration${pending.length === 1 ? "" : "s"}`,
        url: options.endpoint,
        token: options.mintToken(),
        pendingLabel: "Migrating…",
      },
    };
  }

  // Nothing pending. Deliberately no button: it would run nothing and change
  // nothing, and the developer would be back here having been told to try.
  const mentioned = await anyMigrationMentions(missing.name);
  return {
    title: `${subject} does not exist, and every migration has already run.`,
    detail: mentioned
      ? `A migration does mention \`${missing.name}\`, so this is more likely a rollback ` +
        `that left the schema behind, or a migration that did not create what its name ` +
        `suggests. \`bun zt migrate:status\` shows what ran, and \`migrate:refresh\` ` +
        `rebuilds from scratch — it will destroy the data in this database.`
      : `No migration in \`database/migrations\` mentions \`${missing.name}\`, which usually ` +
        `means the migration that would create it was never written. \`bun zt make:migration\` ` +
        `scaffolds one.`,
  };
}
