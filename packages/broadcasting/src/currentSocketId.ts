import { RequestContext } from "@zerotal/core";

/** Read the client's Echo socket id from the current request's `X-Socket-ID` header, if any. */
export function currentSocketId(): string | undefined {
  return RequestContext.tryGet()?.header("x-socket-id") ?? undefined;
}
