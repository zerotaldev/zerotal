/**
 * Notification center — app-wired. The `@zerotal/notifications` facade has no
 * generic "current user's notifications" query (that depends on your auth +
 * schema), so the admin owns the *UI* and the app supplies the *data* via a
 * provider:
 *
 *   Panel.notifications({
 *     async resolve() {
 *       const u = Auth.user();
 *       return (await u.notifications().latest().limit(20).get()).map((n) => ({
 *         id: String(n.id),
 *         title: n.data.title,
 *         body: n.data.body,
 *         href: n.data.url,
 *         read: n.read_at != null,
 *         time: n.created_at,
 *       }));
 *     },
 *     async markRead(id) { await Notification.find(id)?.markAsRead(); },
 *     async markAllRead() { await Auth.user().unreadNotifications().markAsRead(); },
 *     async unreadCount() { return Auth.user().unreadNotifications().count(); },
 *   });
 *
 * When no provider is configured, the bell and page are simply hidden.
 *
 * **Live / broadcast.** The notifications page polls (`flow:poll`) and listens on a
 * broadcast channel (`@on("echo:…")`) so notifications appear without a manual
 * reload. Broadcast a notification from the app on the channel named by
 * {@link NOTIFICATION_CHANNEL} / {@link NOTIFICATION_EVENT} and the open page
 * refreshes; the header bell's unread badge refreshes on each navigation (and
 * whenever the page re-renders from a poll/broadcast tick).
 */

/** The Echo channel the admin listens on for live notification broadcasts. */
export const NOTIFICATION_CHANNEL = "admin-notifications";
/** The Echo event name (a `broadcastAs` dotted name) the admin listens for. */
export const NOTIFICATION_EVENT = ".notification.sent";

export interface AdminNotification {
  id: string;
  title: string;
  body?: string;
  /** Optional link the notification points to (navigated on click). */
  href?: string;
  /** Optional icon key (see ui/icons). */
  icon?: string;
  /** Whether the notification has been read. */
  read?: boolean;
  /** Human/ISO timestamp shown beside the title. */
  time?: string;
}

export interface NotificationProvider {
  /** Resolve the current user's notifications (newest first). */
  resolve(): Promise<AdminNotification[]> | AdminNotification[];
  /** Mark one notification read. */
  markRead?(id: string): Promise<void> | void;
  /** Mark all notifications read. */
  markAllRead?(): Promise<void> | void;
  /**
   * Unread count for the header bell badge. Defaults to counting unread items
   * from {@link resolve} when omitted — supply this for a cheaper count query.
   */
  unreadCount?(): Promise<number> | number;
}
