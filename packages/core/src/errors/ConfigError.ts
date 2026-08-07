/**
 * The error raised for invalid or missing configuration — a bad config file,
 * an unknown key, or a value that fails its schema.
 */
import { ZerotalError } from "./ZerotalError.ts";

/** Raised when configuration is invalid or missing. */
export class ConfigError extends ZerotalError {
  constructor(message: string) {
    super(message, "E_CONFIG_ERROR", 500);
  }
}
