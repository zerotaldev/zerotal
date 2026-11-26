/**
 * Session keys for setting up two-factor authentication, shared by the routes under
 * app/routes/(auth)/settings/two-factor/, and the step that makes a code work once.
 */
import { DB } from "zerotal/orm";

/** The secret between "show the QR code" and "confirm a code" — not saved to the user until then. */
export const SETUP_SECRET_KEY = "two_factor_setup_secret";

/** Freshly made recovery codes, flashed for exactly one page view: they are shown once. */
export const RECOVERY_CODES_FLASH = "recovery_codes";

/**
 * Save `step`, the time step a code matched, as the user's last, unless a code from that step
 * or a later one was accepted first. True when this call saved it.
 *
 * One conditional UPDATE rather than reading the user and saving them: two requests carrying
 * the same code at the same moment both read the old step, and both would have been let in.
 * The database lets one of them change the row, and only that one sees a row changed.
 */
export async function claimTwoFactorStep(userId: number, step: number): Promise<boolean> {
  const changed = await DB.table("users")
    .where("id", userId)
    .where((q) =>
      q.whereNull("two_factor_last_counter").orWhere("two_factor_last_counter", "<", step),
    )
    .updateCount({ two_factor_last_counter: step });
  return changed === 1;
}
