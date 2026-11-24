/**
 * Session keys for setting up two-factor authentication, shared by the routes under
 * app/routes/(auth)/settings/two-factor/.
 */

/** The secret between "show the QR code" and "confirm a code" — not saved to the user until then. */
export const SETUP_SECRET_KEY = "two_factor_setup_secret";

/** Freshly made recovery codes, flashed for exactly one page view: they are shown once. */
export const RECOVERY_CODES_FLASH = "recovery_codes";
