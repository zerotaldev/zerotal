import { ZerotalError } from "@zerotal/core";

/** Base class for all social-authentication errors (@zerotal/auth). */
export class SocialError extends ZerotalError {
  constructor(message: string, code = "E_SOCIAL", status = 500, context?: Record<string, unknown>) {
    super(message, code, status, context);
  }
}

/** Thrown when a driver name is requested that was never registered. */
export class UnknownSocialDriverError extends SocialError {
  constructor(name: string) {
    super(`[Social] Driver "${name}" is not registered.`, "E_SOCIAL_DRIVER_NOT_REGISTERED", 500, {
      driver: name,
    });
  }
}

/** Thrown when the OAuth callback `state` is missing or does not match the stored value. */
export class OAuthStateMismatchError extends SocialError {
  constructor() {
    super("invalid_state", "E_OAUTH_STATE_INVALID", 400);
  }
}

/** Thrown when the OAuth callback is missing the authorization code. */
export class OAuthMissingCodeError extends SocialError {
  constructor() {
    super("missing_code", "E_OAUTH_MISSING_CODE", 400);
  }
}

/** Thrown when a stateful flow runs without an active HTTP request context. */
export class SocialContextUnavailableError extends SocialError {
  constructor() {
    super(
      "[Social] No active HTTP request context. " +
        "Use .stateless().user(code) for flows that run outside a request.",
      "E_SOCIAL_NO_CONTEXT",
      500,
    );
  }
}

/** Thrown when the provider token exchange fails or returns an unexpected response. */
export class OAuthTokenExchangeError extends SocialError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "E_OAUTH_TOKEN_EXCHANGE", 502, context);
  }
}

/** Thrown when fetching the user profile from the provider fails. */
export class OAuthUserFetchError extends SocialError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "E_OAUTH_USER_FETCH", 502, context);
  }
}

/** Thrown when Apple credentials are insufficient to derive a client secret. */
export class AppleClientSecretError extends SocialError {
  constructor() {
    super(
      "[Social/Apple] No clientSecret provided.  Supply either a pre-signed JWT " +
        "as `clientSecret`, or your raw Apple credentials: `teamId`, `keyId`, `privateKey`.",
      "E_OAUTH_APPLE_CLIENT_SECRET",
      500,
    );
  }
}
