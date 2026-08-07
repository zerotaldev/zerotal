/**
 * Authentication and authorization for Zerotal.
 *
 * Covers the whole surface: session login via the {@link Auth} facade
 * ({@link Auth.attempt}, {@link Auth.user}, {@link Auth.logout}), bearer API
 * tokens ({@link PersonalAccessToken}) and JWTs, {@link Gate}/{@link Policy}
 * authorization, relational roles & permissions (RBAC), password reset and
 * magic-link brokers, TOTP two-factor auth, WebAuthn {@link Passkeys}, and
 * social/OAuth login ({@link Social} — GitHub, Google, Apple, and more).
 * Password hashing ({@link Hash}) defaults to argon2id and every token is
 * stored hashed.
 *
 * Builds on `@zerotal/session` — register `SessionProvider` then `AuthProvider`.
 *
 * @example Log a user in
 * ```ts
 * import { Auth } from "@zerotal/auth";
 *
 * if (await Auth.attempt({ email, password }, remember)) {
 *   return redirect("/dashboard");
 * }
 * return redirect().back().withErrors({ email: "These credentials do not match our records." });
 * ```
 *
 * @example Authorize an action
 * ```ts
 * import { Gate } from "@zerotal/auth";
 *
 * Gate.define("update-post", (user, post) => post.authorId === user.id);
 *
 * if (await Gate.allows("update-post", post)) {
 *   // …
 * }
 * ```
 *
 * @remarks
 * Discovers the authenticatable model from the registry, so `ctx.user` and
 * {@link Auth.user} work with no extra wiring. Requires **Bun ≥ 1.1**.
 *
 * @packageDocumentation
 */

// @zerotal/auth -- public API

// -- Base model & composable mixins -------------------------------------------
export { AuthUser } from "./AuthUser.ts";
export { Authenticatable, isAuthenticatable, AUTHENTICATABLE } from "./Authenticatable.ts";
export {
  EmailVerification,
  hasEmailVerification,
  EMAIL_VERIFICATION,
} from "./EmailVerification.ts";
export { PasswordReset, hasPasswordReset, PASSWORD_RESET } from "./PasswordReset.ts";

// -- Auth facade --------------------------------------------------------------
export { Auth } from "./facades/Auth.ts";
export type { UserModel, Credentials, LoginOptions } from "./facades/Auth.ts";

// -- Provider -----------------------------------------------------------------
export { AuthProvider } from "./provider/AuthProvider.ts";

// -- Middleware ----------------------------------------------------------------
// PersistUserMiddleware populates ctx.user on every request (registered globally by
// AuthProvider). AuthMiddleware is the opt-in guard that requires an authenticated
// user — the inverse of GuestMiddleware.
export { PersistUserMiddleware } from "./PersistUserMiddleware.ts";
export { RememberMeMiddleware } from "./RememberMeMiddleware.ts";
export type { RememberMeOptions } from "./RememberMeMiddleware.ts";
export {
  REMEMBER_COOKIE,
  REMEMBER_MAX_AGE,
  mintRememberToken,
  hashRememberToken,
  rememberTokenMatches,
} from "./RememberMe.ts";
export { AuthMiddleware } from "./AuthMiddleware.ts";
export type { AuthOptions } from "./AuthMiddleware.ts";
export { GuestMiddleware } from "./GuestMiddleware.ts";
export type { GuestOptions } from "./GuestMiddleware.ts";
export {
  ConfirmPasswordMiddleware,
  PASSWORD_CONFIRMED_AT_KEY,
  DEFAULT_PASSWORD_TIMEOUT,
} from "./ConfirmPasswordMiddleware.ts";
export type { ConfirmPasswordOptions } from "./ConfirmPasswordMiddleware.ts";
export {
  AuthenticateSessionMiddleware,
  AUTH_PASSWORD_HASH_KEY,
} from "./AuthenticateSessionMiddleware.ts";
export type { AuthenticateSessionOptions } from "./AuthenticateSessionMiddleware.ts";
export { BearerTokenMiddleware } from "./BearerTokenMiddleware.ts";
export { TwoFactorMiddleware } from "./TwoFactorMiddleware.ts";
export {
  TWO_FACTOR_SESSION_KEY,
  TWO_FACTOR_PENDING_KEY,
  TWO_FACTOR_REMEMBER_KEY,
} from "./TwoFactorMiddleware.ts";

// -- Login throttling / lockout -----------------------------------------------
export { LoginRateLimiter, loginThrottle } from "./LoginRateLimiter.ts";
export type { LoginThrottleOptions } from "./LoginRateLimiter.ts";

// -- HTTP Basic auth ----------------------------------------------------------
export { BasicAuthMiddleware } from "./BasicAuthMiddleware.ts";
export type { BasicAuthOptions } from "./BasicAuthMiddleware.ts";

// -- Compromised-password (Have I Been Pwned) ---------------------------------
export { isPasswordCompromised } from "./CompromisedPassword.ts";
export type { CompromisedCheckOptions } from "./CompromisedPassword.ts";

// -- Email OTP (passwordless code login) --------------------------------------
export { EmailOtpBroker } from "./EmailOtpBroker.ts";
export type { EmailOtpOptions } from "./EmailOtpBroker.ts";

// -- Multiple guards ----------------------------------------------------------
export { RequestGuard } from "./guards.ts";
export type { Guard, RequestGuardResolver } from "./guards.ts";

// -- JWT ----------------------------------------------------------------------
export { Jwt } from "./Jwt.ts";
export type { JwtPayload, JwtSignOptions } from "./Jwt.ts";
export { JwtGuardMiddleware } from "./JwtGuardMiddleware.ts";
export type { JwtGuardOptions } from "./JwtGuardMiddleware.ts";

// -- Hashing ------------------------------------------------------------------
export { HashService } from "./HashService.ts";
export { Hash } from "./facades/Hash.ts";

// -- Authorization ------------------------------------------------------------
export { GateService } from "./GateService.ts";
export { Gate } from "./Gate.ts";
export { Policy } from "./Policy.ts";

// -- Role gating middleware ---------------------------------------------------
export { RequireRoleMiddleware } from "./roles/RequireRoleMiddleware.ts";

// -- Relational RBAC (DB-backed roles & permissions) --------------------------
export { Role } from "./rbac/Role.ts";
export { Permission, _attachModelPermissions } from "./rbac/Permission.ts";
export { Roles, hasRolesMixin, ROLES_MIXIN } from "./rbac/Roles.ts";
export { Permissions, hasPermissionsMixin, PERMISSIONS_MIXIN } from "./rbac/Permissions.ts";
export { RequirePermissionMiddleware } from "./rbac/RequirePermissionMiddleware.ts";
export {
  PermissionRegistry,
  definePermission,
  registeredPermissions,
} from "./rbac/PermissionRegistry.ts";

// -- Two-factor authentication ------------------------------------------------
export { TwoFactorService, RECOVERY_CODE_BITS } from "./TwoFactorService.ts";
export { TwoFactor } from "./facades/TwoFactor.ts";
export type { TwoFactorOptions } from "./TwoFactorService.ts";

// Config
export { AuthConfig } from "./config.ts";
export type { AuthConfigShape } from "./config.ts";

// -- Personal access tokens ---------------------------------------------------
export {
  createToken,
  hashToken,
  tokenCan,
  type TokenRow,
  type NewToken,
} from "./PersonalAccessToken.ts";

// -- Password reset -----------------------------------------------------------
export { PasswordBroker } from "./PasswordBroker.ts";
export { PASSWORDS } from "./PasswordBroker.ts";
export type { PasswordBrokerOptions, PasswordBrokerResult } from "./PasswordBroker.ts";

// -- Magic links / signed URLs ------------------------------------------------
// URLSigner / Url now live in @zerotal/core — import them from there.
export { MagicLinkBroker } from "./MagicLinkBroker.ts";
export { MAGIC } from "./MagicLinkBroker.ts";
export { ValidateSignatureMiddleware } from "./ValidateSignatureMiddleware.ts";
export type {
  MagicLinkUser,
  MagicLinkBrokerOptions,
  MagicLinkBrokerResult,
} from "./MagicLinkBroker.ts";

// -- WebAuthn / Passkeys ------------------------------------------------------
export { PasskeyService } from "./Passkeys.ts";
export type { PasskeyCredential, PasskeyUser, PasskeysOptions } from "./Passkeys.ts";

// -- Social authentication (OAuth2) -------------------------------------------
// Merged from the former @zerotal/social package — social login is an auth
// concern. Re-exports the full surface (SocialManager, SocialProvider, Social
// facade, drivers, SocialConfig, types, errors) and activates the Router.social()
// macro typing + the `social` config-registry augmentation.
export * from "./social/index.ts";

// -- Framework instrumentation events (emitted on the core FrameworkEvents bus) --
// Apps also dispatch some of these directly (e.g. Registered, EmailVerified).
export {
  LoginAttempted,
  LoginSucceeded,
  LoginFailed,
  LoggedOut,
  Lockout,
  Registered,
  EmailVerified,
  PasswordResetLinkSent,
  // The bare `PasswordReset` name is the stateless reset mixin (exported above);
  // the framework event is surfaced as `PasswordResetEvent`.
  PasswordReset as PasswordResetEvent,
  PasswordConfirmed,
  CurrentDeviceLogout,
  OtherDeviceLogout,
  TokenIssued,
  AuthorizationDenied,
} from "./events.ts";
