/** Directory middleware for the group-middleware test: counts the requests it sees. */
import type { HttpContext, NextFn } from "@zerotal/core";

export class DirCount {
  static calls = 0;

  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    DirCount.calls++;
    return next();
  }
}

export const middleware = [DirCount];
