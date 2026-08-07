import { describe, it, expect } from "bun:test";
import { ZerotalError } from "@zerotal/core";
import {
  QueueError,
  QueueNotInitializedError,
  QueueShuttingDownError,
  QueueBatchingUnsupportedError,
} from "./errors.ts";

describe("queue errors", () => {
  it("all extend QueueError and ZerotalError", () => {
    for (const e of [
      new QueueNotInitializedError(),
      new QueueShuttingDownError("SendMail"),
      new QueueBatchingUnsupportedError(),
    ]) {
      expect(e).toBeInstanceOf(QueueError);
      expect(e).toBeInstanceOf(ZerotalError);
    }
  });
  it("carry stable codes and statuses", () => {
    expect(new QueueNotInitializedError().code).toBe("E_QUEUE_NOT_INITIALIZED");
    const s = new QueueShuttingDownError("SendMail");
    expect(s.code).toBe("E_QUEUE_SHUTTING_DOWN");
    expect(s.status).toBe(503);
    expect(s.message).toContain("SendMail");
    expect(new QueueBatchingUnsupportedError().code).toBe("E_QUEUE_BATCHING_UNSUPPORTED");
  });
});
