import { ZerotalError } from "@zerotal/core";

/** Base class for all @zerotal/cache errors. */
export class CacheError extends ZerotalError {
  constructor(message: string, code = "E_CACHE", status = 500, context?: Record<string, unknown>) {
    super(message, code, status, context);
  }
}

/** Thrown when a value cannot be JSON-serialized for storage. */
export class CacheSerializationError extends CacheError {
  constructor(key: string, cause: unknown) {
    super(
      `[Zerotal Cache] Failed to serialize value for key "${key}": ${(cause as Error)?.message ?? String(cause)}`,
      "E_CACHE_SERIALIZATION",
      500,
      { key },
    );
  }
}

/** Thrown when a cached value cannot be JSON-parsed on read. */
export class CacheDeserializationError extends CacheError {
  constructor(key: string, cause: unknown) {
    super(
      `[Zerotal Cache] Failed to deserialize cached value for key "${key}": ${(cause as Error)?.message ?? String(cause)}`,
      "E_CACHE_DESERIALIZATION",
      500,
      { key },
    );
  }
}
