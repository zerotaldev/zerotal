import { AuthMiddleware } from "zerotal/auth";

/**
 * Every route in (auth)/ needs a signed-in user. A guest is sent to /login, and back
 * to the page they asked for once they have signed in.
 */
export const middleware = [AuthMiddleware];
