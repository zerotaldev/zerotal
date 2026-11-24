import { BaseMiddleware, NotFoundError, type HttpContext, type NextFn } from "zerotal";
import { ConfirmPasswordMiddleware } from "zerotal/auth";
import { passkeysEnabled } from "@app/auth/passkeys";

/** With passkeys off (no PASSKEY_RP_ID), these pages do not exist. */
class PasskeysEnabled extends BaseMiddleware {
  protected options = {};

  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    if (!passkeysEnabled()) throw new NotFoundError();
    return next();
  }
}

// Adding or removing a passkey asks for the password again if it has not been entered
// in the last three hours.
export const middleware = [PasskeysEnabled, ConfirmPasswordMiddleware];
