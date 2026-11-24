import { AuthMiddleware, AuthenticateSessionMiddleware } from "zerotal/auth";
import { TrackSession } from "@app/middleware/TrackSession";

/**
 * Every route in (auth)/ needs a signed-in user. A guest is sent to /login, and back to
 * the page they asked for once they have signed in.
 *
 * - `AuthenticateSessionMiddleware` ends this session when the password changes
 *   somewhere else — a reset, or a change made on another device.
 * - `TrackSession` keeps Settings → Sessions' list of signed-in browsers current, and
 *   signs this one out if it was removed from that list.
 */
export const middleware = [AuthMiddleware, AuthenticateSessionMiddleware, TrackSession];
