/**
 * In-process delivery counters, kept for the admin panel.
 *
 * Best-effort and deliberately bounded: this is the "what is happening right
 * now" view an operator wants when a channel starts failing, not a history. It
 * is not persisted, and it resets when the process does — the durable record of
 * a notification is the database channel.
 */
import { FrameworkEvents } from "@zerotal/core";
import { NotificationSent } from "./events.ts";

/** The most recent deliveries retained for the panel's feed. */
const MAX_RECENT = 200;

/** One recorded delivery attempt on one channel. */
export interface RecentDelivery {
  at: number;
  className: string;
  channel: string;
  notifiable: string;
  ok: boolean;
  durationMs: number;
  error: string | undefined;
}

/** Per-channel totals since the process booted. */
export interface ChannelStat {
  channel: string;
  sent: number;
  failed: number;
  /** Mean duration in milliseconds across successful sends. */
  avgMs: number;
}

const _recent: RecentDelivery[] = [];
const _byChannel = new Map<string, { sent: number; failed: number; totalMs: number }>();
let _installed: (() => void) | undefined;

/** Subscribe the counters to the delivery event bus. Idempotent. */
export function installNotificationStats(): () => void {
  if (_installed) return _installed;

  const off = FrameworkEvents.on(NotificationSent, (e) => {
    _recent.push({
      at: Date.now(),
      className: e.className,
      channel: e.channel,
      notifiable: e.notifiable,
      ok: e.ok,
      durationMs: e.durationMs,
      error: e.error,
    });
    if (_recent.length > MAX_RECENT) _recent.splice(0, _recent.length - MAX_RECENT);

    const stat = _byChannel.get(e.channel) ?? { sent: 0, failed: 0, totalMs: 0 };
    if (e.ok) {
      stat.sent++;
      stat.totalMs += e.durationMs;
    } else {
      stat.failed++;
    }
    _byChannel.set(e.channel, stat);
  });

  _installed = () => {
    off();
    _installed = undefined;
  };
  return _installed;
}

/** Recent delivery attempts, newest first. */
export function recentDeliveries(): RecentDelivery[] {
  return [..._recent].reverse();
}

/** Per-channel totals, busiest first. */
export function channelStats(): ChannelStat[] {
  return [..._byChannel.entries()]
    .map(([channel, s]) => ({
      channel,
      sent: s.sent,
      failed: s.failed,
      avgMs: s.sent > 0 ? Math.round(s.totalMs / s.sent) : 0,
    }))
    .sort((a, b) => b.sent + b.failed - (a.sent + a.failed));
}

/** @internal Clear the counters. Tests only. */
export function _resetStats(): void {
  _recent.length = 0;
  _byChannel.clear();
}
