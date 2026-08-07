/**
 * Auth → observer bridges. The auth stack emits security-audit framework events
 * (login success/failure, logout, authorization denial, token issuance) on the
 * core `FrameworkEvents` bus; this module forwards them to whichever observer
 * packages are installed.
 *
 * Each observer's write surface is resolved from the container by binding key and
 * typed through a local structural interface, so this package depends on none of
 * the observer packages — installing or removing an observer requires no change here.
 */
import { FrameworkEvents, RequestContext } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import {
  LoginSucceeded,
  LoginFailed,
  LoggedOut,
  AuthorizationDenied,
  TokenIssued,
} from "./events.ts";

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

/** The subset of the devtools trace sink this bridge calls (bound as `devtools.trace`). */
interface DevtoolsSink {
  channel(descriptor: {
    id: string;
    label: string;
    badge?: string;
    title?: string;
    meta?: string[];
    warn?: string;
    order?: number;
  }): void;
  record(ctx: object, channel: string, entry: Record<string, unknown>): void;
}

/** The subset of the logger this bridge calls (bound as `log`). */
interface LogSink {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/**
 * Resolve an observer's write surface, or `undefined` when that package is not
 * installed.
 *
 * The cast is confined here: each binding is declared by the package that owns
 * it, and this one deliberately depends on none of them, so the token is not in
 * `ContainerBindings` from where it is looked up.
 */
function _observer<T>(app: Application, binding: string): T | undefined {
  return app.container.tryMake(binding as never) as T | undefined;
}

/**
 * Subscribe the auth audit events to every installed observer. Returns a disposer
 * that removes every subscription; call it from the auth provider's `onStopping()`.
 */
export function installAuthObservability(app: Application): () => void {
  const unsubs: Array<() => void> = [];

  const store = _observer<MonitorSink>(app, "monitor.store");
  if (store) {
    unsubs.push(
      FrameworkEvents.on(LoginSucceeded, (e) =>
        store.recordEvent({
          kind: "auth",
          label: "login.succeeded",
          status: "ok",
          route: e.guard,
          data: { user: String(e.userId) },
        }),
      ),
      FrameworkEvents.on(LoginFailed, (e) =>
        store.recordEvent({
          kind: "auth",
          label: "login.failed",
          status: "warn",
          route: e.guard,
          data: { user: e.identifier, detail: e.reason },
        }),
      ),
      FrameworkEvents.on(LoggedOut, (e) =>
        store.recordEvent({
          kind: "auth",
          label: "logout",
          status: "info",
          route: e.guard,
          data: { user: String(e.userId) },
        }),
      ),
      FrameworkEvents.on(AuthorizationDenied, (e) =>
        store.recordEvent({
          kind: "auth",
          label: "authorization.denied",
          status: "bad",
          route: e.ability,
          data: { user: e.userId != null ? String(e.userId) : "guest", detail: e.ability },
        }),
      ),
      FrameworkEvents.on(TokenIssued, (e) =>
        store.recordEvent({
          kind: "auth",
          label: "token.issued",
          status: "ok",
          route: null,
          data: { user: String(e.userId), detail: e.abilities.join(", ") },
        }),
      ),
    );
  }

  const trace = _observer<DevtoolsSink>(app, "devtools.trace");
  if (trace) {
    // One open channel rather than a field devtools has to know about: the
    // descriptor says how a row reads, and devtools renders it without shipping
    // any auth-specific code.
    trace.channel({
      id: "auth",
      label: "Auth",
      badge: "event",
      title: "detail",
      meta: ["guard", "user"],
      warn: "failed",
      order: 30,
    });

    const record = (entry: Record<string, unknown>): void => {
      const ctx = RequestContext.tryGet();
      if (ctx) trace.record(ctx, "auth", entry);
    };

    unsubs.push(
      FrameworkEvents.on(LoginSucceeded, (e) =>
        record({ event: "login", detail: "succeeded", guard: e.guard, user: String(e.userId) }),
      ),
      FrameworkEvents.on(LoginFailed, (e) =>
        record({
          event: "login",
          detail: e.reason,
          guard: e.guard,
          user: e.identifier,
          failed: true,
        }),
      ),
      FrameworkEvents.on(LoggedOut, (e) =>
        record({ event: "logout", detail: "signed out", guard: e.guard, user: String(e.userId) }),
      ),
      FrameworkEvents.on(AuthorizationDenied, (e) =>
        record({
          event: "denied",
          detail: e.ability,
          user: e.userId != null ? String(e.userId) : "guest",
          failed: true,
        }),
      ),
      FrameworkEvents.on(TokenIssued, (e) =>
        record({ event: "token", detail: e.abilities.join(", "), user: String(e.userId) }),
      ),
    );
  }

  const log = _observer<LogSink>(app, "log");
  if (log) {
    unsubs.push(
      FrameworkEvents.on(LoginSucceeded, (e) =>
        log.info("Login succeeded", { guard: e.guard, userId: e.userId }),
      ),
      FrameworkEvents.on(LoginFailed, (e) =>
        log.warn("Login failed", { guard: e.guard, identifier: e.identifier, reason: e.reason }),
      ),
      FrameworkEvents.on(LoggedOut, (e) =>
        log.info("User logged out", { guard: e.guard, userId: e.userId }),
      ),
      FrameworkEvents.on(AuthorizationDenied, (e) =>
        log.warn("Authorization denied", { ability: e.ability, userId: e.userId }),
      ),
    );
  }

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
