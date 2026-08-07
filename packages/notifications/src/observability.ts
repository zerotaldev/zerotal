/**
 * Notifications → observer bridges. The mail/notification stack emits its own
 * `MessageSent` / `MessageQueued` / `MessageFailed` / `NotificationSent` framework
 * events on the core `FrameworkEvents` bus; this module forwards them to whichever
 * observer packages are installed.
 *
 * Each observer's write surface is resolved from the container by binding key and
 * typed through a local structural interface, so this package depends on none of
 * the observer packages — installing or removing an observer requires no change here.
 */
import { FrameworkEvents, RequestContext } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { MessageSent, MessageQueued, MessageFailed, NotificationSent } from "./events.ts";

/** The subset of the monitor store this bridge calls (bound as `monitor.store`). */
interface MonitorSink {
  recordMail(m: {
    subject: string;
    to: string;
    mailer: string;
    status: "sent" | "queued" | "failed";
    ms: number;
    body: string;
  }): void;
  recordEvent(e: {
    kind: string;
    label: string;
    status?: "ok" | "warn" | "bad" | "info";
    route?: string | null;
    data?: Record<string, unknown>;
  }): void;
}

/** The subset of the devtools trace sink this bridge calls (bound as `devtools.trace`). */
interface DevtoolsSink {
  bufferMail(
    ctx: object,
    m: {
      className: string;
      to: string[];
      subject: string;
      html: string;
      durationMs: number;
      queued: boolean;
    },
  ): void;
}

/** The subset of the logger this bridge calls (bound as `log`). */
interface LogSink {
  error(message: string, context?: Record<string, unknown>, error?: unknown): void;
}

/**
 * Subscribe the notification events to every installed observer. Returns a disposer
 * that removes every subscription; call it from the provider's `onStopping()`.
 */
export function installNotificationsObservability(app: Application): () => void {
  const unsubs: Array<() => void> = [];

  const store = app.container.tryMake("monitor.store" as never) as MonitorSink | undefined;
  if (store) {
    unsubs.push(
      FrameworkEvents.on(MessageSent, (e) =>
        store.recordMail({
          subject: e.subject,
          to: e.to.join(", "),
          mailer: e.className,
          status: e.queued ? "queued" : "sent",
          ms: Math.round(e.durationMs),
          body: e.html,
        }),
      ),
      FrameworkEvents.on(MessageFailed, (e) =>
        store.recordMail({
          subject: e.subject,
          to: e.to.join(", "),
          mailer: e.className,
          status: "failed",
          ms: Math.round(e.durationMs),
          body: e.error,
        }),
      ),
      FrameworkEvents.on(MessageQueued, (e) =>
        store.recordMail({
          subject: e.subject,
          to: e.to.join(", "),
          mailer: e.className,
          status: "queued",
          ms: 0,
          body: `Queued for delivery on "${e.queue}".`,
        }),
      ),
      FrameworkEvents.on(NotificationSent, (e) =>
        store.recordEvent({
          kind: "notification",
          label: e.className,
          status: e.ok ? "ok" : "bad",
          route: e.channel,
          data: {
            channel: e.channel,
            to: e.notifiable,
            ms: Math.round(e.durationMs),
            detail: e.error ?? e.notifiable,
          },
        }),
      ),
    );
  }

  const trace = app.container.tryMake("devtools.trace" as never) as DevtoolsSink | undefined;
  if (trace) {
    unsubs.push(
      // Mail happens outside the HTTP frame, so correlate to the in-flight request.
      FrameworkEvents.on(MessageSent, (e) => {
        const ctx = RequestContext.tryGet();
        if (!ctx) return;
        trace.bufferMail(ctx, {
          className: e.className,
          to: e.to,
          subject: e.subject,
          html: e.html,
          durationMs: e.durationMs,
          queued: e.queued,
        });
      }),
    );
  }

  const log = app.container.tryMake("log" as never) as LogSink | undefined;
  if (log) {
    unsubs.push(
      FrameworkEvents.on(MessageFailed, (e) =>
        log.error(
          "Mail send failed",
          { className: e.className, to: e.to, subject: e.subject, durationMs: e.durationMs },
          new Error(e.error),
        ),
      ),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
