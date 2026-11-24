import { AuthMiddleware } from "zerotal/auth";

/**
 * Routes in (verified)/ also need a confirmed email address. Anyone who has not clicked
 * the link yet is sent to /verify-email, which offers to send it again.
 *
 * Settings sit outside this group on purpose: someone who mistyped their address at
 * registration has to be able to reach Settings → Profile to fix it.
 */
export const middleware = [AuthMiddleware.with({ mustVerifyEmail: true })];
