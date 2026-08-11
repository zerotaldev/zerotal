import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware, withHeaders } from "@zerotal/core";

/**
 * Precognition support.
 *
 * Inertia "precognition" lets the client validate a form against the server's real rules
 * without running the controller's side effects. The validation itself happens inside
 * `FormRequest.validate()` (which short-circuits with a 204 or 422 when `Precognition: true`); this
 * middleware just guarantees every response to a precognitive request carries `Vary: Precognition`
 * so caches don't mix precognition and normal responses.
 *
 * Register it globally (before route middleware) when using precognitive forms.
 */
export class PrecognitionMiddleware extends BaseMiddleware {
  protected options: Record<string, never> = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const isPrecognitive = http.request.headers.get("Precognition") === "true";

    const response = await next();

    if (isPrecognitive && response) {
      const vary = response.headers.get("Vary");
      const merged = !vary
        ? "Precognition"
        : vary.split(",").some((v) => v.trim() === "Precognition")
          ? vary
          : `${vary}, Precognition`;
      return withHeaders(response, { Vary: merged });
    }
  }
}
