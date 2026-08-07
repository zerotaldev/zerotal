import { describe, it, expect } from "bun:test";
import { ChannelRegistry, compileChannelPattern } from "./ChannelRegistry.ts";

describe("compileChannelPattern", () => {
  it("compiles a [param] pattern into a regex + ordered names", () => {
    const { regex, paramNames } = compileChannelPattern("orders.[orderId]");
    expect(paramNames).toEqual(["orderId"]);
    expect(regex.test("orders.42")).toBe(true);
    expect(regex.exec("orders.42")?.[1]).toBe("42");
    expect(regex.test("orders.42.extra")).toBe(false); // a param matches one segment only
    expect(regex.test("orders")).toBe(false);
  });

  it("handles multiple params and static patterns", () => {
    const multi = compileChannelPattern("chat.[room].[topic]");
    expect(multi.paramNames).toEqual(["room", "topic"]);
    const m = multi.regex.exec("chat.5.general");
    expect(m?.slice(1)).toEqual(["5", "general"]);

    const stat = compileChannelPattern("posts");
    expect(stat.paramNames).toEqual([]);
    expect(stat.regex.test("posts")).toBe(true);
    expect(stat.regex.test("posts.1")).toBe(false);
  });
});

describe("ChannelRegistry.authorize", () => {
  it("returns matched:false when no pattern claims the channel", async () => {
    const reg = new ChannelRegistry();
    expect(await reg.authorize("private-unknown.1", { id: 1 })).toEqual({ matched: false });
  });

  it("strips the private- prefix and passes params after the user", async () => {
    const reg = new ChannelRegistry();
    const seen: unknown[] = [];
    reg.register("orders.[orderId]", (user, orderId) => {
      seen.push([user, orderId]);
      return (user as { id: number }).id === Number(orderId);
    });

    const ok = await reg.authorize("private-orders.7", { id: 7 });
    expect(ok).toEqual({ matched: true, result: true });
    expect(seen[0]).toEqual([{ id: 7 }, "7"]);

    const denied = await reg.authorize("private-orders.7", { id: 99 });
    expect(denied).toEqual({ matched: true, result: false });
  });

  it("supports presence channels returning member data", async () => {
    const reg = new ChannelRegistry();
    reg.register("chat.[roomId]", (user, roomId) => {
      const u = user as { id: number; name: string };
      return Number(roomId) === 1 ? { id: u.id, name: u.name } : null;
    });

    const joined = await reg.authorize("presence-chat.1", { id: 3, name: "Ada" });
    expect(joined).toEqual({ matched: true, result: { id: 3, name: "Ada" } });

    const blocked = await reg.authorize("presence-chat.2", { id: 3, name: "Ada" });
    expect(blocked).toEqual({ matched: true, result: null });
  });

  it("awaits async callbacks", async () => {
    const reg = new ChannelRegistry();
    reg.register("async.[id]", async (_user, id) => Number(id) > 0);
    expect(await reg.authorize("private-async.5", {})).toEqual({ matched: true, result: true });
  });

  it("lists and clears registrations", () => {
    const reg = new ChannelRegistry();
    reg.register("orders.[orderId]", () => true);
    reg.register("posts", () => true);
    expect(reg.all()).toEqual([
      { pattern: "orders.[orderId]", paramNames: ["orderId"] },
      { pattern: "posts", paramNames: [] },
    ]);
    reg.clear();
    expect(reg.all()).toEqual([]);
  });
});
