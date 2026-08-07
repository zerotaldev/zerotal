/**
 * Live realtime/WebSocket readings from `@zerotal/flow`. Defensive: if Flow
 * changes or isn't active, falls back to empty/0 rather than throwing.
 */
import { flowActiveConnections, flowConnections } from "@zerotal/flow";
import type { FlowConnection } from "@zerotal/flow";

/** Number of currently-open Flow WebSocket connections. */
export function activeConnections(): number {
  try {
    return flowActiveConnections();
  } catch {
    return 0;
  }
}

/** The currently-connected Flow clients (who, not just how many). */
export function connectedClients(): FlowConnection[] {
  try {
    return flowConnections();
  } catch {
    return [];
  }
}
