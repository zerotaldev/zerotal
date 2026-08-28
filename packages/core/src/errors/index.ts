/**
 * Public barrel for the framework's error types (the `@zerotal/core/errors`
 * subpath) — the base {@link ZerotalError}, the {@link HttpError} hierarchy of
 * status-coded convenience classes, and the validation/config/container errors.
 * Every error carries a stable machine-readable `code` and an HTTP `status`.
 *
 * @example
 * ```ts
 * import { NotFoundError, ValidationError } from "@zerotal/core/errors";
 *
 * throw new NotFoundError("User not found");
 * throw new ValidationError("Invalid input", { email: ["is required"] });
 * ```
 *
 * @packageDocumentation
 */
export { ZerotalError } from "./ZerotalError.ts";
export {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  GoneError,
  UnprocessableEntityError,
  TooManyRequestsError,
  ServiceUnavailableError,
  ContextOutsideRequestError,
} from "./HttpError.ts";
export { ValidationError } from "./ValidationError.ts";
export { ConfigError } from "./ConfigError.ts";
export { RuntimeMismatchError } from "./RuntimeMismatchError.ts";
export { BootCheckError } from "../application/BootDoctor.ts";
export type { BootCheckFailure } from "../application/BootDoctor.ts";
export { ConfigValidationError } from "../config/validation.ts";
export {
  BindingNotFoundError,
  ScopedOutsideRequestError,
  ScopedAfterFlushError,
  SyncResolutionError,
  CircularDependencyError,
  FacadeAccessedBeforeBootError,
  FacadeBindingMissingError,
  ContainerLockedError,
} from "./ContainerErrors.ts";
