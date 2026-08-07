/**
 * Impersonation — acting as another user, and getting back.
 *
 * The support request nobody can reproduce is usually solved by seeing what the
 * person actually sees. This lets an operator become a user, marks the session
 * so the panel can say so, and gives them one click back:
 *
 *   static recordActions() {
 *     return [viewAction(), editAction(), impersonateAction()];
 *   }
 *
 * Two rules hold it together, and both matter:
 *
 * - **The original user is remembered in the session**, so returning is always
 *   possible and never depends on the impersonated account.
 * - **Nobody may impersonate someone who could impersonate them back.** The
 *   resource's own `can("impersonate", record)` decides, and the default is to
 *   refuse rather than allow.
 */
import { frameworkLog } from "@zerotal/core/logger";

/** Session key holding the original user's id while impersonating. */
export const IMPERSONATOR_KEY = "admin.impersonator";

/** The session surface this needs — kept structural so `@zerotal/session` stays optional. */
interface SessionLike {
  get<T = unknown>(key: string): T | undefined;
  put(key: string, value: unknown): unknown;
  forget(key: string): unknown;
}

/** Resolve the request's session, or nothing when there isn't one. */
async function currentSession(): Promise<SessionLike | null> {
  try {
    const { RequestContext } = (await import("@zerotal/core")) as {
      RequestContext: { tryGet: () => { session?: SessionLike } | undefined };
    };
    return RequestContext.tryGet()?.session ?? null;
  } catch {
    return null;
  }
}

/** Auth, resolved lazily so it stays an optional peer. */
async function auth(): Promise<{
  user: () => { id?: unknown; name?: unknown } | null;
  loginUsingId?: (id: unknown) => Promise<unknown> | unknown;
} | null> {
  try {
    const mod = (await import(/* @vite-ignore */ "@zerotal/auth" as string)) as {
      Auth?: {
        user: () => { id?: unknown; name?: unknown } | null;
        loginUsingId?: (id: unknown) => Promise<unknown> | unknown;
      };
    };
    return mod.Auth ?? null;
  } catch {
    return null;
  }
}

/** Whether this request is running as somebody else. */
export async function isImpersonating(): Promise<boolean> {
  const session = await currentSession();
  return session?.get(IMPERSONATOR_KEY) != null;
}

/** The impersonated user's display name, for the banner. */
export async function impersonatedName(): Promise<string | null> {
  if (!(await isImpersonating())) return null;
  const a = await auth();
  const user = a?.user();
  const name = user?.["name" as keyof typeof user];
  return typeof name === "string" ? name : user?.id != null ? `#${String(user.id)}` : null;
}

/**
 * Become `userId`, remembering who to come back as.
 *
 * Refuses to start a second impersonation on top of a first: nesting makes
 * "stop" ambiguous, and there is no case where it helps.
 */
export async function startImpersonating(userId: unknown): Promise<[true] | [false, string]> {
  const [session, a] = await Promise.all([currentSession(), auth()]);
  if (!session) return [false, "Impersonation needs a session."];
  if (!a?.loginUsingId) return [false, "Impersonation needs @zerotal/auth."];
  if (session.get(IMPERSONATOR_KEY) != null) {
    return [false, "Already impersonating — stop first."];
  }

  const current = a.user();
  if (current?.id == null) return [false, "Nobody is signed in."];
  if (String(current.id) === String(userId)) return [false, "That is already you."];

  session.put(IMPERSONATOR_KEY, current.id);
  try {
    await a.loginUsingId(userId);
  } catch (error) {
    // Put the marker back the way it was rather than leaving a session that
    // claims to be impersonating when the switch never happened.
    session.forget(IMPERSONATOR_KEY);
    frameworkLog("admin").warn("Impersonation failed", { userId }, error);
    return [false, "Could not switch to that user."];
  }
  return [true];
}

/** Return to whoever started the impersonation. */
export async function stopImpersonating(): Promise<[true] | [false, string]> {
  const [session, a] = await Promise.all([currentSession(), auth()]);
  const original = session?.get(IMPERSONATOR_KEY);
  if (!session || original == null) return [false, "Not impersonating."];
  if (!a?.loginUsingId) return [false, "Impersonation needs @zerotal/auth."];

  try {
    await a.loginUsingId(original);
  } catch (error) {
    frameworkLog("admin").warn("Could not restore the original user", undefined, error);
    return [false, "Could not switch back — sign in again."];
  } finally {
    // Cleared either way: a marker left behind would strand the session in a
    // state where the banner shows but "stop" does nothing.
    session.forget(IMPERSONATOR_KEY);
  }
  return [true];
}
