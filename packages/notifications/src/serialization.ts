/**
 * Queue serialization for notifications.
 *
 * A notification queued with `notifyLater()` may be delivered by a different
 * process from the one that queued it, so both the notification and its
 * recipient have to survive a round trip through JSON. This module defines that
 * wire form and rebuilds both sides of it.
 *
 * The recipient crosses as a **snapshot**, not a live model: channels read the
 * `Notifiable` contract (`id`, `email`, `name`, `phone`) plus whatever else the
 * model exposes through `toJSON()`. A hydrated notifiable is a plain object, so
 * a `to*()` method that calls a model *method* on its recipient will not find it
 * — read fields, not behaviour, when a notification is queued.
 */
import { NotificationRegistry } from "./NotificationRegistry.ts";
import { UnknownNotificationTypeError } from "./errors.ts";
import type { Notification } from "./Notification.ts";
import type { Notifiable } from "./types.ts";

/** The serialized form of a notifiable — its public fields plus routing hints. */
export interface SerializedNotifiable extends Record<string, unknown> {
  id: number | string;
  /** The recipient's model/class name, so the database channel keeps its `notifiable_type`. */
  __type?: string;
  /** The resolved broadcast channel, captured because the method itself cannot cross. */
  __broadcastChannel?: string;
}

/** The serialized form of one queued notification. */
export interface SerializedNotification {
  notifiable: SerializedNotifiable;
  type: string;
  data: Record<string, unknown>;
}

/** True for values that survive `JSON.stringify` without surprises. */
function isPlain(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.every(isPlain);
  if (t === "object") {
    const proto = Object.getPrototypeOf(value as object) as unknown;
    return proto === Object.prototype || proto === null;
  }
  return false;
}

/**
 * Snapshot a notifiable for the queue.
 *
 * ORM models expose `toJSON()`, which already strips internal state (`_original`,
 * `_exists`, …) and honours `hidden`/`visible`; that is the preferred source. For
 * a plain object, own enumerable non-underscore fields are copied instead. Values
 * that would not survive JSON (class instances, functions) are dropped rather
 * than silently corrupted.
 */
export function serializeNotifiable(notifiable: Notifiable): SerializedNotifiable {
  const candidate = notifiable as unknown as { toJSON?: () => Record<string, unknown> };
  const source =
    typeof candidate.toJSON === "function"
      ? candidate.toJSON()
      : (notifiable as unknown as Record<string, unknown>);

  const out: SerializedNotifiable = { id: notifiable.id };
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("_") || key.startsWith("$")) continue;
    if (!isPlain(value)) continue;
    out[key] = value;
  }

  // `id` may be hidden from toJSON() — the contract needs it regardless.
  out.id = notifiable.id;

  const type = notifiable.constructor?.name;
  if (type && type !== "Object") out.__type = type;

  // Resolve the custom broadcast channel now: it is a method, and methods do not
  // cross a queue boundary.
  const channel = notifiable.receivesBroadcastNotificationsOn?.();
  if (channel !== undefined) out.__broadcastChannel = channel;

  return out;
}

/** Rebuild a notifiable snapshot into something the channels can consume. */
export function hydrateNotifiable(data: SerializedNotifiable): Notifiable {
  const { __broadcastChannel, ...fields } = data;
  const notifiable = fields as unknown as Notifiable;
  if (__broadcastChannel !== undefined) {
    notifiable.receivesBroadcastNotificationsOn = () => __broadcastChannel;
  }
  return notifiable;
}

/** The notifiable's originating class name, used as `notifiable_type`. */
export function notifiableType(notifiable: Notifiable): string {
  const explicit = (notifiable as unknown as { __type?: string }).__type;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  const name = notifiable.constructor?.name;
  return name && name !== "Object" ? name : "Notifiable";
}

/** Serialize one notification plus its recipient into the queued job payload. */
export function serializeNotification(
  notifiable: Notifiable,
  notification: Notification,
): SerializedNotification {
  return {
    notifiable: serializeNotifiable(notifiable),
    type: notification.constructor.name,
    data: notification.payload(),
  };
}

let _discovered = false;

/**
 * Import `app/notifications/*.ts` so every notification class registers itself.
 *
 * A worker thread does not boot a full application, so the classes it must
 * rebuild have never been imported there. This runs once, lazily, the first time
 * a name fails to resolve — an app whose notifications are all already imported
 * never pays for it.
 */
export async function discoverNotifications(): Promise<void> {
  if (_discovered) return;
  _discovered = true;

  const dir = `${process.cwd()}/app/notifications`;
  try {
    const glob = new Bun.Glob("**/*.ts");
    for await (const file of glob.scan({ cwd: dir, absolute: true })) {
      const mod = (await import(`file://${file.replace(/\\/g, "/")}`)) as Record<string, unknown>;
      for (const exported of Object.values(mod)) {
        if (typeof exported === "function" && isNotificationClass(exported as AnyConstructor)) {
          NotificationRegistry.register(exported as never);
        }
      }
    }
  } catch {
    /* app/notifications/ doesn't exist — nothing to discover */
  }
}

/** Any constructor, used only for walking a prototype chain. */
type AnyConstructor = new (...args: never[]) => unknown;

/** Walk the prototype chain looking for the `Notification` base class by name. */
function isNotificationClass(value: AnyConstructor): boolean {
  let proto: unknown = Object.getPrototypeOf(value) as unknown;
  while (typeof proto === "function") {
    if ((proto as AnyConstructor).name === "Notification") return true;
    proto = Object.getPrototypeOf(proto) as unknown;
  }
  return false;
}

/**
 * Rebuild a notification from its class name and serialized state, discovering
 * app notification classes on demand when the name is not yet registered.
 *
 * @throws {UnknownNotificationTypeError} when the class cannot be found.
 */
export async function hydrateNotification(
  type: string,
  data: Record<string, unknown>,
): Promise<Notification> {
  let NotificationClass = NotificationRegistry.resolve(type);
  if (!NotificationClass) {
    await discoverNotifications();
    NotificationClass = NotificationRegistry.resolve(type);
  }
  if (!NotificationClass) {
    throw new UnknownNotificationTypeError(type, [...NotificationRegistry.all().keys()]);
  }

  if (typeof NotificationClass.fromPayload === "function") {
    return NotificationClass.fromPayload(data);
  }
  return Object.assign(Object.create(NotificationClass.prototype) as Notification, data);
}

/** @internal Reset discovery memoization. Tests only. */
export function _resetDiscovery(): void {
  _discovered = false;
}
