/**
 * AI → observer bridges. This package emits `AiGenerated` / `AiRefused` /
 * `AiToolCalled` on core's `FrameworkEvents` bus; this module forwards them to
 * whichever observer packages happen to be installed.
 *
 * Each observer's write surface is resolved from the container by binding key
 * and typed through a local structural interface, so this package depends on
 * none of them — installing or removing an observer requires no change here.
 */
import { FrameworkEvents } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { AiGenerated, AiRefused, AiToolCalled } from "./events.ts";
import { recordDelivery } from "./stats.ts";

/** The subset of the monitor store this bridge calls (bound as `monitor.store`). */
interface MonitorSink {
  recordEvent(e: {
    kind: string;
    label: string;
    status?: "ok" | "warn" | "bad" | "info";
    route?: string | null;
    data?: Record<string, unknown>;
  }): void;
}

/** The subset of the logger this bridge calls (bound as `log`). */
interface LogSink {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>, error?: unknown): void;
}

/**
 * Subscribe the AI events to every installed observer, plus this package's own
 * counters. Returns a disposer; call it from the provider's `onStopping()`.
 */
export function installAiObservability(app: Application): () => void {
  const unsubs: Array<() => void> = [];
  const refused = new Set<string>();

  // A refusal is reported as a *failed* generation as well, so the two events
  // arrive for the same call. Remembering the preview lets the delivery row be
  // labelled a refusal rather than a generic failure.
  unsubs.push(
    FrameworkEvents.on(AiRefused, (e) => {
      refused.add(e.preview);
    }),
  );

  unsubs.push(
    FrameworkEvents.on(AiGenerated, (e) => {
      const wasRefusal = !e.ok && refused.delete(e.preview);
      recordDelivery({
        at: Date.now(),
        driver: e.driver,
        model: e.model,
        operation: e.operation,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        cacheReadTokens: e.cacheReadTokens,
        durationMs: e.durationMs,
        costUsd: e.costUsd,
        ok: e.ok,
        refused: wasRefusal,
        preview: e.preview,
        ...(e.error ? { error: e.error } : {}),
      });
    }),
  );

  const store = app.container.tryMake("monitor.store" as never) as MonitorSink | undefined;
  if (store) {
    unsubs.push(
      FrameworkEvents.on(AiGenerated, (e) =>
        store.recordEvent({
          kind: "ai",
          label: `${e.operation} · ${e.model}`,
          status: e.ok ? "ok" : "bad",
          route: e.driver,
          data: {
            driver: e.driver,
            model: e.model,
            operation: e.operation,
            inputTokens: e.inputTokens,
            outputTokens: e.outputTokens,
            costUsd: Number(e.costUsd.toFixed(6)),
            ms: Math.round(e.durationMs),
            detail: e.error ?? e.preview,
          },
        }),
      ),
      FrameworkEvents.on(AiToolCalled, (e) =>
        store.recordEvent({
          kind: "ai.tool",
          label: e.tool,
          status: e.ok ? "ok" : "bad",
          route: e.driver,
          data: { step: e.step, ms: Math.round(e.durationMs), detail: e.error ?? "" },
        }),
      ),
    );
  }

  const log = app.container.tryMake("log" as never) as LogSink | undefined;
  if (log) {
    unsubs.push(
      // A refusal is not a bug, so it is a warning rather than an error — but it
      // is also invisible otherwise, since the HTTP call succeeded.
      FrameworkEvents.on(AiRefused, (e) =>
        log.warn("AI request refused by the provider", {
          driver: e.driver,
          model: e.model,
          category: e.category,
          prompt: e.preview,
        }),
      ),
      FrameworkEvents.on(AiGenerated, (e) => {
        if (e.ok) return;
        log.error(
          "AI generation failed",
          { driver: e.driver, model: e.model, operation: e.operation, prompt: e.preview },
          new Error(e.error ?? "unknown error"),
        );
      }),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
