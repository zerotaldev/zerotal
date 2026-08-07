import { ZerotalError } from "@zerotal/core";
import type { ValidationErrors } from "./types.ts";

/**
 * Thrown by `FormRequest.validate()` during an Inertia **Precognition** request
 * (`Precognition: true` header). A precognition request validates the incoming data without running
 * the controller's side effects, so the client can show live validation feedback.
 *
 * The global exception handler in `@zerotal/core` renders this by calling `toResponse()`:
 *   - success → `204 No Content` with `Precognition-Success: true`
 *   - failure → `422` with the (optionally field-filtered) errors as JSON
 *
 * Both responses carry `Precognition: true` and `Vary: Precognition`.
 */
export class PrecognitionResponseError extends ZerotalError {
  override readonly name = "PrecognitionResponse";

  constructor(
    public readonly precognitionStatus: 204 | 422,
    public readonly errors: ValidationErrors = {},
  ) {
    super("Precognition", "E_PRECOGNITION", precognitionStatus);
  }

  toResponse(): Response {
    const headers: Record<string, string> = {
      Precognition: "true",
      Vary: "Precognition",
    };

    if (this.precognitionStatus === 204) {
      headers["Precognition-Success"] = "true";
      return new Response(null, { status: 204, headers });
    }

    return new Response(JSON.stringify({ message: "Validation failed", errors: this.errors }), {
      status: 422,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}
