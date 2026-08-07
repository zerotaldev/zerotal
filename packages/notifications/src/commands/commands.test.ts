import { describe, it, expect } from "bun:test";
import { BufferWriter } from "@zerotal/core";
import { NotificationsPruneCommand } from "./NotificationsPruneCommand.ts";
import { NotificationsTestCommand } from "./NotificationsTestCommand.ts";

/**
 * Collect what a command writes instead of printing it. `flush()` empties the
 * buffer, so the drained text is kept for repeated assertions.
 */
function capture(command: { _writer: BufferWriter }): { output(): string } {
  const writer = new BufferWriter();
  command._writer = writer;
  let drained = "";
  return {
    output: () => {
      drained += writer.flush();
      return drained;
    },
  };
}

function appWith(database: Record<string, unknown>): unknown {
  return { container: { makeSync: () => ({ database }) } };
}

describe("notifications:prune", () => {
  it("is named and described", () => {
    expect(NotificationsPruneCommand.commandName).toBe("notifications:prune");
    expect(NotificationsPruneCommand.needsApp).toBe(true);
  });

  it("prunes read notifications at the default threshold", async () => {
    const calls: Array<[number, boolean]> = [];
    const command = new NotificationsPruneCommand();
    const out = capture(command);
    command.app = appWith({
      prune: async (days: number, includeUnread: boolean) => {
        calls.push([days, includeUnread]);
        return 4;
      },
    });

    await command.run();

    expect(calls).toEqual([[30, false]]);
    expect(out.output()).toContain("Pruned 4 notification(s) older than 30 day(s)");
    expect(out.output()).toContain("that had been read");
  });

  it("honours --days and --all", async () => {
    const calls: Array<[number, boolean]> = [];
    const command = new NotificationsPruneCommand();
    const out = capture(command);
    command.flags = { days: 7, all: true };
    command.app = appWith({
      prune: async (days: number, includeUnread: boolean) => {
        calls.push([days, includeUnread]);
        return 0;
      },
    });

    await command.run();

    expect(calls).toEqual([[7, true]]);
    expect(out.output()).toContain("including unread");
  });

  it("rejects a nonsensical --days rather than issuing the delete", async () => {
    let called = false;
    const command = new NotificationsPruneCommand();
    const out = capture(command);
    command.flags = { days: "yesterday" };
    command.app = appWith({
      prune: async () => {
        called = true;
        return 0;
      },
    });

    await command.run();

    expect(called).toBe(false);
    expect(out.output()).toContain("must be a non-negative number");
  });
});

describe("notifications:test", () => {
  it("is named and described", () => {
    expect(NotificationsTestCommand.commandName).toBe("notifications:test");
    expect(NotificationsTestCommand.args[0]!.name).toBe("email");
  });

  it("rejects an argument that is not an address", async () => {
    const command = new NotificationsTestCommand();
    const out = capture(command);
    command.args = { email: "not-an-address" };
    command.app = { container: { makeSync: () => ({}) } };

    await command.run();
    expect(out.output()).toContain("is not an email address");
  });

  it("routes a test notification to the given address", async () => {
    const routed: Array<Record<string, unknown>> = [];
    const command = new NotificationsTestCommand();
    const out = capture(command);
    command.args = { email: "ada@test.local" };
    command.app = {
      container: {
        makeSync: () => ({
          route: (routes: Record<string, unknown>) => {
            routed.push(routes);
            return { notify: async () => undefined };
          },
        }),
      },
    };

    await command.run();

    expect(routed).toEqual([{ mail: "ada@test.local" }]);
    expect(out.output()).toContain("Sent.");
  });

  it("surfaces the provider's own error when the send fails", async () => {
    const command = new NotificationsTestCommand();
    const out = capture(command);
    command.args = { email: "ada@test.local" };
    command.app = {
      container: {
        makeSync: () => ({
          route: () => ({
            notify: async () => {
              throw new Error("535 Bad credentials");
            },
          }),
        }),
      },
    };

    await command.run();
    expect(out.output()).toContain("535 Bad credentials");
  });
});
