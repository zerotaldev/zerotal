import { BroadcastConfig } from "@zerotal/broadcasting";
import type { BroadcastConfigShape } from "@zerotal/broadcasting";
import { env } from "zerotal";

/**
 * The built-in WebSocket driver, served by the application process.
 *
 * `ws` rather than `redis` or `pusher` because the cookbook should run with
 * `bun run dev` and nothing else — a feature that needs a second service before
 * it does anything is a feature nobody tries. The driver is a real WebSocket
 * server either way; what Redis buys is fan-out across processes, which a single
 * dev process does not need.
 *
 * The cast is the same one `config/queue.ts` carries and for the same reason:
 * `env()` returns `string`, `driver` is a literal union, so the assignment in
 * docs/broadcasting/index.md does not compile without it. See T10.
 */
export default BroadcastConfig({
  path: "/app/ws",
  driver: env("BROADCAST_DRIVER", "ws") as BroadcastConfigShape["driver"],

  // This app routes from `app/routes`, so the default `routes/channels.ts` would
  // mean a second top-level directory called routes holding one file. Not under
  // `app/routes` either: everything there is a URL, and the channel rules are
  // not a page. See T13.
  channels: "app/channels.ts",
});
