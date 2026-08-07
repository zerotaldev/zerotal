/**
 * The global `request()` helper — returns the active HTTP context, or reads a
 * single merged input value from it (route params, body, then query string).
 */
import { RequestContext } from "../context/RequestContext.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";

/**
 * Retrieves the active HTTP request context from the async execution fiber.
 *
 * @returns {HttpContext} The current request context.
 * @throws {Error} If called outside of an active HTTP request lifecycle.
 *
 * @example
 * // Access the full context
 * const ctx = request();
 * const token = ctx.bearerToken();
 */
export function request(): HttpContext;

/**
 * Retrieves a deeply merged input value from the current request.
 *
 * **Resolution Priority:**
 * 1. Route parameters (e.g., `ctx.params['id']`)
 * 2. Parsed body data (e.g., JSON or FormData)
 * 3. Query string parameters (e.g., `?page=2`)
 *
 * ⚠️ **Note:** Body resolution is synchronous. It will only find body data if it
 * has already been parsed and cached (e.g., via a `FormRequest` or `await ctx.body()`).
 *
 * @template T - The expected return type of the input value.
 * @param {string} key - The name of the input field to resolve.
 * @param {T} [fallback] - An optional default value to return if the key is missing.
 * @returns {T | undefined} The resolved input value, the fallback, or undefined.
 *
 * @example
 * // Get a value with a fallback
 * const page = request('page', '1');
 *
 * // Get a typed value
 * const id = request<number>('id');
 */
export function request<T = string>(key: string, fallback?: T): T | undefined;

/**
 * Implementation of the global request helper.
 */
export function request<T = string>(key?: string, fallback?: T): HttpContext | T | undefined {
  const ctx = RequestContext.get();

  if (!ctx)
    throw new Error(
      "The request() helper can only be called within an active HTTP request context.",
    );

  if (key === undefined) {
    return ctx;
  }

  return ctx.input<T>(key, fallback);
}
