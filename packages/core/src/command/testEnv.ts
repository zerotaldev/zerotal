/**
 * The environment `bun zt test` hands its child, and the one thing it takes away.
 *
 * Bun loads `.env` into every process it starts, so a test run inherits the
 * developer's whole local setup — including the driver keys that decide whether
 * a code path talks to something real. A developer with `MAIL_DRIVER=smtp`
 * pointed at a local Postfix gets a suite where every path that sends mail opens
 * an SMTP connection: one confirmed payment that issues an invitation goes from
 * milliseconds to a five-second timeout, and fails only when run with its
 * siblings. A developer with no mail server configured never sees it, which
 * makes it precisely the kind of failure that lands on one person and looks
 * like flakiness to everyone else.
 *
 * So the drivers below are reset for the test child. Not because `.env` is
 * wrong — it is right for `zt dev`, which is what it was written for — but
 * because "which outbound service does this reach" is a question a test run
 * should answer for itself. The app's own config already defaults to the same
 * safe values; it is only `.env` that overrides them.
 *
 * Two things still win over this:
 *  - a value set in the shell (`MAIL_DRIVER=smtp bun zt test`), which is
 *    someone deliberately testing that path;
 *  - a value in `.env.test`, which is the same intent written down. Bun only
 *    loads that file when `NODE_ENV=test`, so it is read here explicitly rather
 *    than left as a file the docs mention and nothing loads.
 */

/**
 * Driver keys reset for a test run, and what they are reset to. Each default is
 * the in-process option: no socket, no external service, no shared state between
 * runs — and each is already the app config's own default.
 */
export const TEST_SAFE_DRIVERS: Readonly<Record<string, string>> = {
  /** Writes the message to the log instead of opening an SMTP connection. */
  MAIL_DRIVER: "log",
  /** Runs a dispatched job inline, so a test sees its effects without a worker. */
  QUEUE_DRIVER: "sync",
  /** Keeps the session in the cookie rather than reaching for Redis. */
  SESSION_DRIVER: "cookie",
  /** In-process cache, so one test file cannot see another's entries. */
  CACHE_DRIVER: "memory",
};

/**
 * Parse a dotenv file into a map. Deliberately small: this is used to find out
 * *which keys a file mentions*, not to load anything — Bun has already loaded
 * `.env` by the time this runs, and re-implementing its full semantics here
 * would only produce a second, disagreeing answer.
 *
 * @param text - Raw file contents.
 * @returns Key → value, with surrounding quotes stripped.
 */
export function parseDotenv(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
    } else {
      // Unquoted values run to a trailing comment, matching dotenv.
      value = value.replace(/\s+#.*$/, "");
    }
    entries.set(key, value);
  }
  return entries;
}

/** Read and parse a dotenv file, or an empty map when it does not exist. */
async function _read(path: string): Promise<Map<string, string>> {
  const text = await Bun.file(path)
    .text()
    .catch(() => null);
  return text === null ? new Map() : parseDotenv(text);
}

/**
 * Work out what to change about the child process's environment.
 *
 * @param cwd - Project root holding the dotenv files.
 * @param env - The parent's environment, as the child would otherwise inherit it.
 * @returns Keys to override, and the subset of those that were neutralised drivers (for reporting).
 */
export async function testEnvOverrides(
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<{ overrides: Record<string, string>; neutralised: string[] }> {
  const [dotenv, dotenvLocal, dotenvTest] = await Promise.all([
    _read(`${cwd}/.env`),
    _read(`${cwd}/.env.local`),
    _read(`${cwd}/.env.test`),
  ]);

  const overrides: Record<string, string> = {};
  const neutralised: string[] = [];

  for (const [key, safe] of Object.entries(TEST_SAFE_DRIVERS)) {
    const current = env[key];

    // Unset means the app config's default applies, which is already the safe
    // one — setting it anyway would only paper over a config the app changed
    // on purpose.
    if (current === undefined) continue;

    // Already safe: nothing to say, and nothing to report.
    if (current === safe) continue;

    // Set in the shell rather than in a file — someone testing this path on
    // purpose. Inferred by comparing against what the files declare, which is
    // the only handle available: Bun merges dotenv into the environment before
    // any of this runs, and does not record where a value came from.
    const fromFile = dotenv.get(key) === current || dotenvLocal.get(key) === current;
    if (!fromFile) continue;

    overrides[key] = safe;
    neutralised.push(`${key}=${safe}`);
  }

  // `.env.test` last: it is the app saying what a test run should use, which
  // outranks both the inherited value and the default chosen here.
  for (const [key, value] of dotenvTest) {
    overrides[key] = value;
    const index = neutralised.findIndex((entry) => entry.startsWith(`${key}=`));
    if (index !== -1) neutralised.splice(index, 1);
  }

  return { overrides, neutralised };
}
