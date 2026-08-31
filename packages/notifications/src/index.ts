export { Notification } from "./Notification.ts";
// `Notifiable` is exported here as BOTH the mixin (value) and the contract (type) — a
// function+interface merge in Notifiable.ts.
export { Notifiable } from "./Notifiable.ts";
export { NotificationManager } from "./NotificationManager.ts";
export { NotificationFake } from "./NotificationFake.ts";
export { NotificationProvider } from "./provider/NotificationProvider.ts";
export { Notify } from "./facades/Notify.ts";
export { NotificationConfig, validateNotificationConfig } from "./config.ts";

// Channels
export { MailChannel } from "./MailChannel.ts";
export { DatabaseChannel } from "./DatabaseChannel.ts";
export { SlackChannel } from "./SlackChannel.ts";
export { SmsChannel } from "./SmsChannel.ts";
export { BroadcastChannel, BROADCAST_NOTIFICATION_EVENT } from "./BroadcastChannel.ts";

// Per-channel messages
export { MailMessage, RichLine } from "./messages/MailMessage.ts";
export { BroadcastMessage } from "./BroadcastMessage.ts";

// On-demand (model-less) recipients
export { OnDemandNotifiable } from "./OnDemandNotifiable.ts";
export type { OnDemandRoutes } from "./OnDemandNotifiable.ts";

// Queue serialization — a notification outside app/notifications/ registers here.
export { NotificationRegistry } from "./NotificationRegistry.ts";
export type { NotificationClass } from "./NotificationRegistry.ts";

// Mail drivers (for the mail channel) — swap or supply your own transport.
export { LogDriver } from "./drivers/LogDriver.ts";
export { SmtpDriver } from "./drivers/SmtpDriver.ts";
export { ResendDriver } from "./drivers/ResendDriver.ts";
export type {
  MailDriver,
  MailPayload,
  MailAddress,
  MailAttachment,
  AddressInput,
} from "./drivers/MailDriver.ts";
// Exported for the same reason the drivers above are: writing a custom transport
// is a supported thing to do, and a custom transport has to refuse the same header
// names the built-in ones refuse.
export { RESERVED_MAIL_HEADERS, resolveHeaders } from "./drivers/MailDriver.ts";

export { SendNotificationJob } from "./SendNotificationJob.ts";
export { BroadcastNotificationJob } from "./BroadcastNotificationJob.ts";
export type {
  NotificationConfigShape,
  MailConfigShape,
  SmsConfigShape,
  TwilioConfigShape,
  VonageConfigShape,
  NotificationChannel,
} from "./types.ts";
export type { NotificationRecord, InboxQuery } from "./DatabaseChannel.ts";
export type { SlackMessage } from "./SlackChannel.ts";
export type { SmsMessage } from "./SmsChannel.ts";
export type { TextStyle } from "./messages/MailMessage.ts";

// Delivery counters backing the admin console.
export { recentDeliveries, channelStats } from "./stats.ts";
export type { RecentDelivery, ChannelStat } from "./stats.ts";

// Console commands
export { NotificationsPruneCommand, NotificationsTestCommand } from "./commands/index.ts";

// Typed error vocabulary
export * from "./errors.ts";

// Framework instrumentation events (emitted on the core FrameworkEvents bus)
export { MessageSent, MessageQueued, MessageFailed, NotificationSent } from "./events.ts";
