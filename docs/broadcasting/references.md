---
title: Broadcasting References
description: The Broadcast facade, channel APIs, errors, and commands.
---

# References

## Configuration

| Key      | Values                                               | Default   |
| -------- | ---------------------------------------------------- | --------- |
| `driver` | `null`, `ws`, `redis`, `pusher`                      | `null`    |
| `path`   | WebSocket endpoint path                              | `/app/ws` |
| `redis`  | `{ url }` — required by the `redis` driver           | —         |
| `pusher` | Pusher credentials — required by the `pusher` driver | —         |

The `null` driver discards everything broadcast to it. That is the right default for
tests and for a development machine with no broker running, and it is why a missing
configuration shows up as silence rather than as an error.

## The BroadcastEvent interface

Any object implementing this can be handed to `Broadcast.send()`:

| Member            | Required | Defaults to                  |
| ----------------- | -------- | ---------------------------- |
| `broadcastOn()`   | Yes      | —                            |
| `broadcastAs()`   | No       | The class's constructor name |
| `broadcastWith()` | No       | `{}`                         |

Because `broadcastAs()` falls back to the constructor name, renaming an event class
silently renames the event clients listen for. Implement it explicitly on anything a
browser subscribes to and the wire name stops depending on a refactor.

## Commands

`@zerotal/broadcasting` ships two channel commands:

| Command                            | What it does                                             |
| ---------------------------------- | -------------------------------------------------------- |
| `bun zt channel:list`              | List registered broadcast channel authorization rules    |
| `bun zt make:channel OrderChannel` | Add a channel authorization rule to `routes/channels.ts` |

## Broadcast facade

| Method                                      | Signature                                                             | Description                                                           |
| ------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Broadcast.send(event, opts?)`              | `(event: BroadcastEvent, opts?: { exceptSocketId?: string }) => void` | Broadcast an event to every channel from its `broadcastOn()`.         |
| `Broadcast.to(channel, name, data?, opts?)` | `(channel: string, eventName: string, data?: unknown, opts?) => void` | Push a raw event to one channel without an event class.               |
| `Broadcast.on(channel)`                     | `(channel: string) => AnonymousBroadcast`                             | Begin an anonymous public broadcast (fluent `.as().with().send()`).   |
| `Broadcast.private(channel)`                | `(channel: string) => AnonymousBroadcast`                             | Anonymous broadcast on a private channel.                             |
| `Broadcast.presence(channel)`               | `(channel: string) => AnonymousBroadcast`                             | Anonymous broadcast on a presence channel.                            |
| `Broadcast.channel(pattern, callback)`      | `(pattern: string, callback: ChannelCallback) => void`                | Register a channel authorization rule (call in `routes/channels.ts`). |
| `Broadcast.channels()`                      | `() => { pattern: string; paramNames: string[] }[]`                   | List registered channel patterns.                                     |
| `Broadcast.getMembers(channel)`             | `(channel: string) => PresenceMember[]`                               | Members of a presence channel (real driver only).                     |
| `Broadcast.fake()`                          | `() => BroadcastFake`                                                 | Swap in an in-memory recorder for tests.                              |
| `Broadcast.resetFake()`                     | `() => void`                                                          | Restore container-backed resolution.                                  |

`getMembers()` reads state the driver holds, so it returns an empty list under the
`null` driver and under `fake()`. Assert presence membership against a real driver,
or assert on the broadcasts themselves instead.

## Errors

| Error                                 | Thrown when                                                              |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `BroadcastProviderNotRegisteredError` | The `Broadcast` facade is used before `BroadcastProvider` is registered. |
| `MissingChannelParameterError`        | A `[param]` placeholder is interpolated without its value.               |

Both extend `BroadcastError`, which extends `ZerotalError`, so one `catch` on
`BroadcastError` covers the pair and a `ZerotalError` handler catches them alongside
the rest of the framework's errors.

## Broadcast notifications

Notifications can be delivered over a broadcast channel in real time — add `'broadcast'` to a
notification's `channels()` and implement `toBroadcast()`. See
[Notifications → Broadcasting](/docs/notifications#broadcast).

## Types

Channel and event types, most of which are inferred from your channel declarations:

| Type                                                      | What it is                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `StaticChannels`, `ParameterizedChannels`                 | Channels with fixed names, and those taking params.                                     |
| `ChannelParams`, `ChannelParamRecord`                     | What a parameterised channel captures.                                                  |
| `ChannelAuthFn`                                           | The authorization callback for a private channel.                                       |
| `PresenceAuthFn`, `PresenceMemberData`                    | The same for presence, plus what a member publishes to the others.                      |
| `AuthorizeResult`                                         | What an auth callback may return — a refusal, or the member data.                       |
| `TypedBroadcastEvent`, `EventsOf`, `PayloadOf`            | An event on a channel, the events a channel carries, and one event's payload.           |
| `BroadcastsModelEventsOptions`, `ModelBroadcastEventName` | Broadcasting a model's own lifecycle, and the event names it produces.                  |
| `BroadcastRecord`                                         | A queued broadcast as stored.                                                           |
| `WsConnectionData`                                        | What the server holds per connection.                                                   |
| `PusherPresenceResolver`                                  | Resolving presence members when running against Pusher rather than the built-in server. |

## Next steps

- [Broadcasting overview](/docs/broadcasting) — the guide's front page and the rest of the sections.
- [Events](/docs/broadcasting/events) — writing the events this facade sends.
- [Testing](/docs/broadcasting/testing) — the fake and its assertions.
