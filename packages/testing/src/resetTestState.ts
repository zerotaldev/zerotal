import { Application, Router, FrameworkEvents } from "@zerotal/core";
import { resetOrmContext } from "@zerotal/orm";

export function resetTestState(): void {
  Application._resetInstance();
  Router.reset();
  resetOrmContext();
  // Clear framework instrumentation subscriptions so handlers registered by one
  // suite (e.g. devtools tracing) don't leak into the next. Providers re-subscribe
  // on boot.
  FrameworkEvents.clear();
}
