/**
 * Process-wide handle to the active {@link MonitorStore}. The provider sets it
 * during boot; the recorder middleware and the {@link ./facades/Monitor.ts}
 * facade read it without needing the IoC container in hand.
 */
import type { MonitorStore } from "./MonitorStore.ts";

let _store: MonitorStore | undefined;

export function _setStore(store: MonitorStore | undefined): void {
  _store = store;
}

export function _getStore(): MonitorStore | undefined {
  return _store;
}
