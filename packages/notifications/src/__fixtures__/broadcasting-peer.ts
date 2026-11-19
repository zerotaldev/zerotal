/**
 * The entry `optionalPeers.test.ts` bundles and runs, standing in for a compiled app.
 *
 * It sends a notification on the `broadcast` channel and runs a queued broadcast job, the two
 * things that load `@zerotal/broadcasting`, and prints one JSON line describing how each went:
 * the error's class, code and the peer it names, or `null` when it got past loading the package.
 */
import { BroadcastChannel } from "../BroadcastChannel.ts";
import { BroadcastNotificationJob } from "../BroadcastNotificationJob.ts";
import { Notification } from "../Notification.ts";

/** The parts of an error the test asserts on. */
function describeError(error: unknown): Record<string, unknown> {
  const e = error as { code?: unknown; missing?: { peer?: unknown; install?: unknown } };
  return {
    threw: error instanceof Error ? error.constructor.name : typeof error,
    code: e.code ?? null,
    peer: e.missing?.peer ?? null,
    install: e.missing?.install ?? null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** How `run` went: `null` when it finished, or the error it threw. */
async function outcome(run: () => Promise<unknown>): Promise<Record<string, unknown> | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return describeError(error);
  }
}

class OrderShipped extends Notification {
  channels(): string[] {
    return ["broadcast"];
  }

  override toBroadcast(): Record<string, unknown> {
    return { order: 1 };
  }
}

const channel = await outcome(() => new BroadcastChannel().send({ id: 1 }, new OrderShipped()));
const job = await outcome(() =>
  new BroadcastNotificationJob("private-notifications.1", "notification", {}).handle(),
);

console.log(JSON.stringify({ channel, job }));
