/**
 * The bridges from Flow's realtime events to whatever observer packages happen to
 * be installed. Flow depends on none of them, so each is faked here by binding key
 * — which is also the only way to assert that a bridge calls what it promises.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { FrameworkEvents } from "@zerotal/core";
import { installFlowObservability } from "./observability.ts";
import { FlowActionHandled } from "./frameworkEvents.ts";

type FinaliseMeta = { startMs: number; durationMs: number; method?: string };

/** A devtools trace sink that records what it was asked to do. */
function fakeSink() {
  const recorded: Array<{ ctx: object; channel: string; entry: Record<string, unknown> }> = [];
  const finalised: Array<{ ctx: object; meta: FinaliseMeta }> = [];
  return {
    recorded,
    finalised,
    sink: {
      channel: () => {},
      record: (ctx: object, channel: string, entry: Record<string, unknown>) => {
        recorded.push({ ctx, channel, entry });
      },
      finalise: (ctx: object, meta: FinaliseMeta) => {
        finalised.push({ ctx, meta });
      },
    },
  };
}

/** An app whose container offers exactly one binding. */
function appWith(binding: string, value: unknown) {
  return {
    container: { tryMake: (key: string) => (key === binding ? value : undefined) },
  } as never;
}

/** The context a Flow action runs against: a synthetic request for its own page. */
function actionCtx(pathname = "/showcase/flow/counter") {
  return { url: { pathname } };
}

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  FrameworkEvents.clear();
});

describe("the devtools bridge", () => {
  it("finalises the action's context, without which nothing it recorded is ever shown", () => {
    // The bug this test exists for. Devtools builds a trace from core's request
    // lifecycle, and a WebSocket action fires none of it — so recording alone left
    // every action's evidence buffered against a context that became no trace, and
    // the Flow tab could only ever say "no flow activity during this request".
    const { sink, recorded, finalised } = fakeSink();
    dispose = installFlowObservability(appWith("devtools.trace", sink));
    const ctx = actionCtx();

    FrameworkEvents.emit(
      new FlowActionHandled("Counter", "increment", 12.4, true, "127.0.0.1", ctx),
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.channel).toBe("flow");
    expect(recorded[0]!.entry["component"]).toBe("Counter");

    expect(finalised).toHaveLength(1);
    expect(finalised[0]!.ctx).toBe(ctx);
    // Same context both times, or the entry lands on one trace and the trace is built from another.
    expect(finalised[0]!.ctx).toBe(recorded[0]!.ctx);
  });

  it("labels the trace FLOW so an action does not read as a second load of its page", () => {
    const { sink, finalised } = fakeSink();
    dispose = installFlowObservability(appWith("devtools.trace", sink));

    FrameworkEvents.emit(
      new FlowActionHandled("Counter", "increment", 12.4, true, null, actionCtx()),
    );

    expect(finalised[0]!.meta.method).toBe("FLOW");
    expect(finalised[0]!.meta.durationMs).toBe(12.4);
    // The start is derived by walking back the duration, the event carrying no
    // absolute start of its own; entry offsets are measured from it.
    expect(finalised[0]!.meta.startMs).toBeLessThanOrEqual(Date.now());
  });

  it("finalises a failed action too, that being the one worth opening the panel for", () => {
    const { sink, recorded, finalised } = fakeSink();
    dispose = installFlowObservability(appWith("devtools.trace", sink));

    FrameworkEvents.emit(new FlowActionHandled("Counter", "boom", 3, false, null, actionCtx()));

    expect(recorded[0]!.entry["failed"]).toBe(true);
    expect(finalised).toHaveLength(1);
  });

  it("leaves framework traffic out of the panel entirely", () => {
    const { sink, recorded, finalised } = fakeSink();
    dispose = installFlowObservability(appWith("devtools.trace", sink));

    FrameworkEvents.emit(
      new FlowActionHandled("Poll", "tick", 1, true, null, actionCtx("/monitor")),
    );

    expect(recorded).toHaveLength(0);
    expect(finalised).toHaveLength(0);
  });

  it("works against a devtools too old to offer finalise", () => {
    // The method postdates the sink, and the two packages can be pinned apart. An
    // untraced action is a worse panel; a thrown TypeError would be a broken action.
    const recorded: object[] = [];
    dispose = installFlowObservability(
      appWith("devtools.trace", {
        channel: () => {},
        record: (ctx: object) => void recorded.push(ctx),
      }),
    );

    expect(() =>
      FrameworkEvents.emit(
        new FlowActionHandled("Counter", "increment", 1, true, null, actionCtx()),
      ),
    ).not.toThrow();
    expect(recorded).toHaveLength(1);
  });

  it("does nothing at all when devtools is not installed", () => {
    dispose = installFlowObservability(appWith("nothing.bound", {}));

    expect(() =>
      FrameworkEvents.emit(
        new FlowActionHandled("Counter", "increment", 1, true, null, actionCtx()),
      ),
    ).not.toThrow();
  });
});
