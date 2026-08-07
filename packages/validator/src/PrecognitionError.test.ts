import { describe, it, expect } from "bun:test";
import { PrecognitionResponseError } from "./PrecognitionError.ts";

describe("PrecognitionResponseError", () => {
  it("has the name the core handler dispatches on", () => {
    expect(new PrecognitionResponseError(204).name).toBe("PrecognitionResponse");
  });

  it("renders a 204 success with Precognition headers", async () => {
    const res = new PrecognitionResponseError(204).toResponse();
    expect(res.status).toBe(204);
    expect(res.headers.get("Precognition")).toBe("true");
    expect(res.headers.get("Precognition-Success")).toBe("true");
    expect(res.headers.get("Vary")).toBe("Precognition");
    expect(await res.text()).toBe("");
  });

  it("renders a 422 with the errors as JSON", async () => {
    const res = new PrecognitionResponseError(422, { email: "Required" }).toResponse();
    expect(res.status).toBe(422);
    expect(res.headers.get("Precognition")).toBe("true");
    expect(res.headers.get("Precognition-Success")).toBeNull();
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = (await res.json()) as { message: string; errors: Record<string, string> };
    expect(body.errors).toEqual({ email: "Required" });
  });
});
