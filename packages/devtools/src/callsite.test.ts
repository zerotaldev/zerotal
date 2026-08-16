import { describe, it, expect } from "bun:test";
import { captureCallSite, firstAppFrame, parseFrame, parseStack } from "./callsite.ts";

describe("parseFrame", () => {
  it("reads the named form", () => {
    expect(parseFrame("    at PostController.index (/app/src/Post.ts:42:9)")).toEqual({
      file: "/app/src/Post.ts",
      line: 42,
      column: 9,
      function: "PostController.index",
    });
  });

  it("reads the bare form", () => {
    expect(parseFrame("    at /app/src/boot.ts:7:1")).toEqual({
      file: "/app/src/boot.ts",
      line: 7,
      column: 1,
    });
  });

  it("strips the async prefix rather than making it part of the name", () => {
    expect(parseFrame("    at async handle (/app/src/Post.ts:1:1)")?.function).toBe("handle");
  });

  it("reads a Windows path, drive letter and all", () => {
    // The colon in `C:` is the reason this needs a real parse and not a split.
    expect(parseFrame("    at run (C:\\app\\src\\Post.ts:12:3)")).toMatchObject({
      file: "C:\\app\\src\\Post.ts",
      line: 12,
    });
  });

  it("returns null for anything that is not a frame", () => {
    expect(parseFrame("Error: boom")).toBeNull();
    expect(parseFrame("")).toBeNull();
    expect(parseFrame("    at [native code]")).toBeNull();
  });
});

describe("parseStack", () => {
  const stack = [
    "Error: boom",
    "    at inner (/app/src/a.ts:1:1)",
    "    at middle (/app/node_modules/x/y.ts:2:2)",
    "    at outer (/app/src/b.ts:3:3)",
  ].join("\n");

  it("keeps every frame, framework ones included", () => {
    // You read a stack trace to find out how you got somewhere, and a trace with
    // the middle removed does not tell you that.
    expect(parseStack(stack).map((f) => f.line)).toEqual([1, 2, 3]);
  });

  it("skips the header line", () => {
    expect(parseStack(stack)[0]!.function).toBe("inner");
  });

  it("honours the limit", () => {
    expect(parseStack(stack, 2)).toHaveLength(2);
  });

  it("returns nothing for a missing stack", () => {
    expect(parseStack(undefined)).toEqual([]);
    expect(parseStack("")).toEqual([]);
  });
});

describe("firstAppFrame", () => {
  /** A stack the way it really arrives: devtools, then the ORM, then the app. */
  const realistic = [
    "Error",
    "    at bufferQuery (/repo/packages/devtools/src/tracing.ts:140:20)",
    "    at listener (/repo/packages/orm/src/observability.ts:150:9)",
    "    at QueryBuilder.get (/repo/node_modules/@zerotal/orm/src/QueryBuilder.ts:88:5)",
    "    at PostController.index (/repo/app/controllers/PostController.ts:42:9)",
    "    at handle (/repo/packages/core/src/router/RouteHandler.ts:120:3)",
  ].join("\n");

  it("skips past the framework to the line that ran it", () => {
    // The whole trick is throwing away frames: every frame above the answer is
    // machinery the reader did not write and cannot act on.
    expect(firstAppFrame(realistic)).toMatchObject({
      file: "/repo/app/controllers/PostController.ts",
      line: 42,
      function: "PostController.index",
    });
  });

  it("rejects an installed framework package as well as a workspace one", () => {
    // A contributor debugging the framework and an app developer using it see
    // different paths for the same file.
    expect(
      firstAppFrame("Error\n    at x (/repo/node_modules/@zerotal/core/src/a.ts:1:1)"),
    ).toBeNull();
    expect(firstAppFrame("Error\n    at x (/repo/packages/core/src/a.ts:1:1)")).toBeNull();
  });

  it("rejects runtime-internal frames", () => {
    expect(firstAppFrame("Error\n    at x (bun:sqlite:1:1)")).toBeNull();
    expect(firstAppFrame("Error\n    at x (node:events:2:2)")).toBeNull();
  });

  it("returns null when there is no application frame at all", () => {
    // A query run from a seeder. Better than pointing at a file nobody wrote.
    const allVendor = [
      "Error",
      "    at a (/repo/packages/devtools/src/tracing.ts:1:1)",
      "    at b (/repo/packages/orm/src/DB.ts:2:2)",
    ].join("\n");
    expect(firstAppFrame(allVendor)).toBeNull();
  });

  it("skips the frames a caller says are its own", () => {
    // The console patch passes 1: it stands between the caller and the stack, and
    // without dropping it every log line would point at devtools.
    const stack = [
      "Error",
      "    at wrapper (/repo/app/wrapper.ts:1:1)",
      "    at caller (/repo/app/caller.ts:2:2)",
    ].join("\n");
    expect(firstAppFrame(stack)?.function).toBe("wrapper");
    expect(firstAppFrame(stack, 1)?.function).toBe("caller");
  });

  it("returns null for a missing stack", () => {
    expect(firstAppFrame(undefined)).toBeNull();
    expect(firstAppFrame("")).toBeNull();
  });
});

describe("captureCallSite", () => {
  it("survives an await, which is the whole reason it can be used at all", async () => {
    // The capture happens where devtools buffers the event, which is after the
    // driver's await. If async frames did not survive, every query would report
    // the framework as its call site and the feature would not work at all.
    //
    // Asserted on the raw stack rather than the filtered result, because this
    // file lives inside the framework and the filter is right to reject it.
    async function appCode(): Promise<string | undefined> {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      return new Error().stack;
    }
    expect(await appCode()).toContain("appCode");
  });

  it("costs what the plan needs it to cost", () => {
    // The one item in the upgrade plan whose viability was genuinely unknown.
    // Flat across stack depths because the engine builds the trace lazily; the
    // budget that matters is a request running forty queries.
    const N = 5_000;
    const started = performance.now();
    for (let i = 0; i < N; i++) captureCallSite();
    const perCall = (performance.now() - started) / N;
    expect(perCall).toBeLessThan(0.05); // 40 queries → well under 2ms
  });
});
