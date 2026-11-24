import type { HttpContext } from "zerotal";
import { DB } from "zerotal/orm";

/**
 * The server's record of each browser a user is signed in on — see
 * database/migrations/0003_create_user_sessions_table.ts for why there is one.
 *
 * The session cookie carries the row's id. app/middleware/TrackSession.ts calls
 * {@link trackSession} on every signed-in request: a browser without an id gets a row,
 * and a browser whose row has gone has been signed out from somewhere else.
 */

/** Session key holding this browser's row id. */
export const SESSION_ROW_KEY = "user_session_id";

/** How often `last_active_at` is written. Every request would be a write per page view. */
const TOUCH_EVERY_MS = 60_000;

interface SessionRow {
  id: string;
  user_id: number;
  ip_address: string | null;
  user_agent: string | null;
  last_active_at: string;
  created_at: string;
}

/** What Settings → Sessions shows for one browser. */
export interface SessionSummary {
  id: string;
  browser: string;
  platform: string;
  ipAddress: string | null;
  lastActiveAt: string;
  current: boolean;
}

/**
 * Record this request against the user's row. Returns `"revoked"` when the row this
 * browser was given no longer exists — it was signed out from another device.
 */
export async function trackSession(http: HttpContext, userId: number): Promise<"ok" | "revoked"> {
  const session = http.session;
  if (!session) return "ok";

  const id = session.get(SESSION_ROW_KEY);
  if (typeof id === "string") {
    const row = (await DB.table("user_sessions").where("id", id).first()) as SessionRow | null;
    if (!row) return "revoked";
    if (Number(row.user_id) === userId) {
      if (Date.now() - new Date(row.last_active_at).getTime() > TOUCH_EVERY_MS) {
        await DB.table("user_sessions")
          .where("id", id)
          .update({ last_active_at: new Date().toISOString(), ip_address: clientIp(http) });
      }
      return "ok";
    }
    // A row for somebody else: this browser signed out and in as another user without
    // its session being cleared. Start this user's own row.
  }

  const now = new Date().toISOString();
  const row: SessionRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    ip_address: clientIp(http),
    user_agent: http.request.headers.get("user-agent")?.slice(0, 500) ?? null,
    last_active_at: now,
    created_at: now,
  };
  await DB.table("user_sessions").insert({ ...row });
  session.set(SESSION_ROW_KEY, row.id);
  return "ok";
}

/** Every browser the user is signed in on, most recently active first. */
export async function listSessions(http: HttpContext, userId: number): Promise<SessionSummary[]> {
  const current = http.session?.get(SESSION_ROW_KEY);
  const rows = (await DB.table("user_sessions")
    .where("user_id", userId)
    .orderBy("last_active_at", "desc")
    .get()) as SessionRow[];

  return rows.map((row) => ({
    id: row.id,
    ...describeUserAgent(row.user_agent),
    ipAddress: row.ip_address,
    lastActiveAt: row.last_active_at,
    current: row.id === current,
  }));
}

/** Sign out every browser but this one. Returns how many were signed out. */
export async function revokeOtherSessions(http: HttpContext, userId: number): Promise<number> {
  const current = http.session?.get(SESSION_ROW_KEY);
  const others = (await DB.table("user_sessions")
    .where("user_id", userId)
    .get()) as SessionRow[];
  const revoke = others.filter((row) => row.id !== current);
  for (const row of revoke) await DB.table("user_sessions").where("id", row.id).delete();
  return revoke.length;
}

/** Forget this browser's row — on sign-out, so the list does not keep a dead entry. */
export async function forgetSession(http: HttpContext): Promise<void> {
  const id = http.session?.get(SESSION_ROW_KEY);
  if (typeof id === "string") await DB.table("user_sessions").where("id", id).delete();
}

/** Every row a user has — when the account itself is deleted. */
export async function forgetAllSessions(userId: number): Promise<void> {
  await DB.table("user_sessions").where("user_id", userId).delete();
}

function clientIp(http: HttpContext): string | null {
  try {
    return http.ip() || null;
  } catch {
    return null;
  }
}

/**
 * "Chrome" on "macOS", from a User-Agent string. Deliberately rough: it names what a
 * person would recognise in a list of their own devices, nothing more.
 */
export function describeUserAgent(ua: string | null): { browser: string; platform: string } {
  const s = ua ?? "";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\//.test(s)
      ? "Opera"
      : /Firefox\//.test(s)
        ? "Firefox"
        : /Chrome\//.test(s)
          ? "Chrome"
          : /Safari\//.test(s)
            ? "Safari"
            : s
              ? "Unknown browser"
              : "Unknown";
  const platform = /iPhone|iPad/.test(s)
    ? "iOS"
    : /Android/.test(s)
      ? "Android"
      : /Mac OS X|Macintosh/.test(s)
        ? "macOS"
        : /Windows/.test(s)
          ? "Windows"
          : /Linux/.test(s)
            ? "Linux"
            : "Unknown device";
  return { browser, platform };
}
