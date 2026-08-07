import type { Notification } from "./Notification.ts";

/**
 * A notification class, optionally with a custom `fromPayload` reviver. The
 * reviver may be async — rebuilding often means loading a record back.
 */
export type NotificationClass = (new (...args: never[]) => Notification) & {
  fromPayload?(data: Record<string, unknown>): Notification | Promise<Notification>;
};

/**
 * Global registry mapping notification class names to their constructors.
 *
 * A queued notification is stored as `{ type, data }` — the class name plus the
 * result of `payload()`. When a worker picks the job up it has only those two
 * strings, so the class must be reachable by name to be rebuilt. That is what
 * this registry provides.
 *
 * Registration is automatic in the common case: {@link discoverNotifications}
 * imports `app/notifications/*.ts` and registers every exported notification
 * class. Call `register()` yourself only for notifications that live elsewhere.
 */
export const NotificationRegistry = {
  _map: new Map<string, NotificationClass>(),

  register(NotificationClass: NotificationClass): void {
    NotificationRegistry._map.set(NotificationClass.name, NotificationClass);
  },

  resolve(className: string): NotificationClass | undefined {
    return NotificationRegistry._map.get(className);
  },

  all(): ReadonlyMap<string, NotificationClass> {
    return NotificationRegistry._map;
  },
};
