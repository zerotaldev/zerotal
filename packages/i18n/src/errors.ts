import { ZerotalError } from "@zerotal/core";

/** Base class for all @zerotal/i18n errors. */
export class I18nError extends ZerotalError {
  constructor(message: string, code = "E_I18N", status = 500, context?: Record<string, unknown>) {
    super(message, code, status, context);
  }
}

/** Thrown when a catalog file exists but cannot be read/parsed as JSON. */
export class CatalogLoadError extends I18nError {
  constructor(file: string, cause: unknown) {
    super(
      `[Zerotal i18n] Failed to load catalog "${file}": ${(cause as Error)?.message ?? String(cause)}`,
      "E_I18N_CATALOG_LOAD",
      500,
      { file },
    );
  }
}
