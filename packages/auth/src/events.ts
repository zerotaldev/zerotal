/**
 * The auth package's framework events (security audit trail), emitted on core's
 * {@link FrameworkEvents} bus. Observability packages subscribe to them by kind
 * (their class name).
 */

/**
 * Emitted when a login is attempted (before credentials are verified).
 * @category Auth
 */
export class LoginAttempted {
  constructor(
    readonly guard: string,
    readonly identifier: string,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted after a successful login.
 * @category Auth
 */
export class LoginSucceeded {
  constructor(
    readonly guard: string,
    readonly userId: string | number,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted after a failed login attempt; `reason` describes why it failed.
 * @category Auth
 */
export class LoginFailed {
  constructor(
    readonly guard: string,
    readonly identifier: string,
    readonly reason: string,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted after a user logs out.
 * @category Auth
 */
export class LoggedOut {
  constructor(
    readonly guard: string,
    readonly userId: string | number,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted when login attempts for an identifier are throttled (too many failures
 * within the window) — use it to alert the account owner or feed intrusion
 * detection.
 * @category Auth
 */
export class Lockout {
  constructor(
    readonly guard: string,
    readonly identifier: string,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted when a new user account is registered (apps dispatch this).
 * @category Auth
 */
export class Registered {
  constructor(readonly userId: string | number) {}
}

/**
 * Emitted after a user confirms their email address.
 * @category Auth
 */
export class EmailVerified {
  constructor(readonly userId: string | number) {}
}

/**
 * Emitted after a password-reset link is dispatched to a user.
 * @category Auth
 */
export class PasswordResetLinkSent {
  constructor(readonly email: string) {}
}

/**
 * Emitted after a user's password is successfully reset.
 * @category Auth
 */
export class PasswordReset {
  constructor(readonly email: string) {}
}

/**
 * Emitted after a user re-confirms their password (sensitive-action gate).
 * @category Auth
 */
export class PasswordConfirmed {
  constructor(
    readonly userId: string | number,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted for the current session when a user logs out other devices.
 * @category Auth
 */
export class CurrentDeviceLogout {
  constructor(
    readonly guard: string,
    readonly userId: string | number,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted when a user's sessions on other devices are invalidated.
 * @category Auth
 */
export class OtherDeviceLogout {
  constructor(
    readonly guard: string,
    readonly userId: string | number,
    readonly ctx: object | undefined,
  ) {}
}

/**
 * Emitted after a personal access token is issued, carrying the granted abilities.
 * @category Auth
 */
export class TokenIssued {
  constructor(
    readonly tokenId: string,
    readonly abilities: string[],
    readonly userId: string | number,
  ) {}
}

/**
 * Emitted when an authorization check denies access; `ability` is the gate or
 * policy ability that failed.
 * @category Auth
 */
export class AuthorizationDenied {
  constructor(
    readonly ability: string,
    readonly userId: string | number | undefined,
    readonly ctx: object | undefined,
  ) {}
}
