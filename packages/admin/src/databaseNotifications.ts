/**
 * Database-backed notifications for the panel's bell.
 *
 * `Panel.notifications()` takes a provider because "the current user's
 * notifications" depends on your auth and your schema. When those are the
 * ordinary ones — `@zerotal/auth` for the user, `@zerotal/notifications`'
 * `DatabaseChannel` for storage — this builds that provider for you:
 *
 *   import { databaseNotifications } from "@zerotal/admin";
 *
 *   Panel.notifications(databaseNotifications());
 *
 * Everything is optional and adjustable: which user the notifications belong to,
 * how a stored row becomes a title and a link, and which table to read.
 *
 * `@zerotal/notifications` is an optional peer: an app that uses this installs
 * it, and one that does not never loads it. Without it, the bell throws an
 * `OptionalPeerMissingError` naming the install command, rather than showing an
 * empty list that looks like nobody has been notified.
 */
import type { AdminNotification, NotificationProvider } from "./notifications.ts";
import { frameworkLog } from "@zerotal/core/logger";
import { optionalPeer, OptionalPeerMissingError } from "@zerotal/core/runtime";

/** A stored notification row, as `DatabaseChannel` writes it. */
export interface StoredNotification {
  id: string;
  notifiable_type: string;
  notifiable_id: string;
  type: string;
  data: string;
  read_at: string | null;
  created_at: string;
}

export interface DatabaseNotificationOptions {
  /** Table holding the notifications. Defaults to `"notifications"`. */
  table?: string | undefined;
  /**
   * Who the bell is showing. Defaults to the signed-in user from
   * `@zerotal/auth`; returning `null` shows nothing, which is the right answer
   * for a guest.
   */
  notifiable?: (() => Promise<unknown> | unknown) | undefined;
  /** How many to show. Defaults to 20 — a bell is not an archive. */
  limit?: number | undefined;
  /**
   * Turn a stored row into what the panel renders. The default reads `title`,
   * `body`/`message`, `url`/`href` and `icon` out of the payload, which is what
   * most notifications carry.
   */
  present?:
    ((row: StoredNotification, data: Record<string, unknown>) => AdminNotification) | undefined;
}

/** Parse a row's JSON payload, tolerating a payload that was never JSON. */
function payloadOf(row: StoredNotification): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.data) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The default presentation: whatever the payload says, with sane fallbacks. */
function defaultPresent(row: StoredNotification, data: Record<string, unknown>): AdminNotification {
  const str = (key: string): string | undefined => {
    const value = data[key];
    return typeof value === "string" && value ? value : undefined;
  };
  return {
    id: row.id,
    // A notification with no title is still worth showing; name it by its class.
    title: str("title") ?? row.type,
    ...((str("body") ?? str("message")) ? { body: str("body") ?? str("message")! } : {}),
    ...((str("url") ?? str("href")) ? { href: str("url") ?? str("href")! } : {}),
    ...(str("icon") ? { icon: str("icon")! } : {}),
    read: row.read_at != null,
    time: row.created_at,
  };
}

/** The part of `@zerotal/notifications` the bell uses. */
interface NotificationsModule {
  DatabaseChannel?: new (table?: string) => DatabaseChannelLike;
}

/**
 * Load `@zerotal/notifications`, or throw `OptionalPeerMissingError` when it is
 * not installed. Shared with the doctor check, so both name the same feature.
 */
export async function loadNotifications(): Promise<NotificationsModule> {
  return import("@zerotal/notifications" as string).catch(
    optionalPeer("@zerotal/notifications", {
      feature: "Panel.notifications(databaseNotifications())",
      alternative: "pass Panel.notifications() a provider of your own",
    }),
  );
}

/** Providers built by {@link databaseNotifications}, so the doctor check can find them. */
const built = new WeakSet<NotificationProvider>();

/** Whether `provider` came from {@link databaseNotifications}, and so needs the package. */
export function isDatabaseNotifications(provider: NotificationProvider): boolean {
  return built.has(provider);
}

/**
 * Build a {@link NotificationProvider} reading from the notifications table.
 *
 * Every method fails soft: a missing table, an unconfigured database or a
 * signed-out user yields an empty bell rather than a broken panel, because a
 * notification centre is never worth taking the page down for. The one
 * exception is `@zerotal/notifications` not being installed, which throws
 * `OptionalPeerMissingError`: no amount of waiting fixes that.
 */
export function databaseNotifications(
  options: DatabaseNotificationOptions = {},
): NotificationProvider {
  const limit = options.limit ?? 20;
  const present = options.present ?? defaultPresent;

  /** The DatabaseChannel instance, resolved lazily and cached. */
  let channel: Promise<DatabaseChannelLike | null> | null = null;
  const getChannel = (): Promise<DatabaseChannelLike | null> => {
    channel ??= (async () => {
      const mod = await loadNotifications();
      if (!mod.DatabaseChannel) return null;
      return new mod.DatabaseChannel(options.table);
    })();
    return channel;
  };

  const getNotifiable = async (): Promise<unknown> => {
    if (options.notifiable) return options.notifiable();
    // A dependency, loaded on first use so a panel without a bell never loads it.
    const mod = (await import("@zerotal/auth" as string)) as {
      Auth?: { user?: () => unknown };
    };
    try {
      return mod.Auth?.user?.() ?? null;
    } catch {
      return null;
    }
  };

  /** Run `fn` against the channel + current user, or yield `fallback`. */
  const withChannel = async <T>(
    fn: (channel: DatabaseChannelLike, notifiable: object) => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    try {
      const [c, notifiable] = await Promise.all([getChannel(), getNotifiable()]);
      if (!c || !notifiable || typeof notifiable !== "object") return fallback;
      return await fn(c, notifiable);
    } catch (error) {
      // Not installed is a setup mistake, not a bad moment: say what to install.
      if (error instanceof OptionalPeerMissingError) throw error;
      frameworkLog("admin").warn("Database notifications unavailable", undefined, error);
      return fallback;
    }
  };

  const provider: NotificationProvider = {
    async resolve(): Promise<AdminNotification[]> {
      return withChannel(async (c, notifiable) => {
        const rows = await c.all(notifiable);
        return rows.slice(0, limit).map((row) => present(row, payloadOf(row)));
      }, []);
    },

    async unreadCount(): Promise<number> {
      return withChannel(async (c, notifiable) => (await c.unread(notifiable)).length, 0);
    },

    async markRead(id: string): Promise<void> {
      await withChannel(async (c) => {
        await c.markAsRead(id);
      }, undefined);
    },

    async markAllRead(): Promise<void> {
      await withChannel(async (c, notifiable) => {
        await c.markAllAsRead(notifiable);
      }, undefined);
    },
  };
  built.add(provider);
  return provider;
}

/** The slice of `DatabaseChannel` this bridge uses. */
interface DatabaseChannelLike {
  all(notifiable: object): Promise<StoredNotification[]>;
  unread(notifiable: object): Promise<StoredNotification[]>;
  markAsRead(id: string): Promise<void>;
  markAllAsRead(notifiable: object): Promise<void>;
}
