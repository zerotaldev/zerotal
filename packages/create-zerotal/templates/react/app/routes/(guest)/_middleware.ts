import { GuestMiddleware } from "zerotal/auth";

/**
 * Every route in (guest)/ is for visitors who are not signed in. Someone who is gets
 * sent on to the dashboard instead of being shown a sign-in form.
 *
 * A directory in parentheses groups routes without adding to their URL:
 * (guest)/login.ts is /login.
 */
export const middleware = [GuestMiddleware];
