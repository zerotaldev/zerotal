import type { HttpContext } from "@zerotal/core";

/** Proves directory middleware is found inside the binary: it stamps every response below it. */
class StampMiddleware {
  async handle(http: HttpContext, next: () => Promise<void>): Promise<void> {
    await next();
    http.response?.headers.set("x-stamped", "docs");
  }
}

export const middleware = [StampMiddleware];
