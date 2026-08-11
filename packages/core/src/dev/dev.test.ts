import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  registerDevBuildHook,
  hasDevBuildHooks,
  runDevBuildHooks,
  _resetDevBuildHooks,
} from "./DevBuildHook.ts";
import { DEV_RELOAD_CLIENT } from "./reloadClient.ts";
import * as DevWsServer from "./DevWsServer.ts";
import { detectCssPlugins, buildCssBundle } from "./CssPlugins.ts";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

// ── DevBuildHook ──────────────────────────────────────────────────────────────

describe("DevBuildHook", () => {
  beforeEach(() => _resetDevBuildHooks());
  afterEach(() => _resetDevBuildHooks());

  it("reports no hooks until one is registered", () => {
    expect(hasDevBuildHooks()).toBe(false);
    registerDevBuildHook("inertia", async () => ({ success: true }));
    expect(hasDevBuildHooks()).toBe(true);
  });

  it("runs every registered package's build, not just the last one", async () => {
    // The failure this guards: an Inertia app that installs @zerotal/monitor
    // boots Flow after Inertia, and a single-slot hook let the second
    // registration silently replace the first — Inertia's bundle then never
    // rebuilt again while dev mode still reported success.
    const ran: string[] = [];
    registerDevBuildHook("inertia", async () => {
      ran.push("inertia");
      return { success: true };
    });
    registerDevBuildHook("flow", async () => {
      ran.push("flow");
      return { success: true };
    });

    const result = await runDevBuildHooks();
    expect(result.success).toBe(true);
    expect(ran.sort()).toEqual(["flow", "inertia"]);
  });

  it("re-registering a name replaces that package's build and adds no duplicate", async () => {
    let calls = 0;
    registerDevBuildHook("inertia", async () => ({ success: true }));
    registerDevBuildHook("inertia", async () => {
      calls++;
      return { success: true };
    });
    await runDevBuildHooks();
    expect(calls).toBe(1);
  });

  it("reports failure with the responsible package named, and still runs the others", async () => {
    const ran: string[] = [];
    registerDevBuildHook("inertia", async () => ({ success: false, logs: ["syntax error"] }));
    registerDevBuildHook("flow", async () => {
      ran.push("flow");
      return { success: true };
    });

    const result = await runDevBuildHooks();
    expect(result.success).toBe(false);
    expect(result.logs).toContain("[inertia] syntax error");
    expect(ran).toEqual(["flow"]);
  });

  it("a throwing build is reported as a failure rather than escaping", async () => {
    registerDevBuildHook("inertia", async () => {
      throw new Error("bundler exploded");
    });
    const result = await runDevBuildHooks();
    expect(result.success).toBe(false);
    expect(String(result.logs?.[0])).toContain("bundler exploded");
  });

  it("succeeds trivially when nothing is registered", async () => {
    // `skipped: false` with no routines: there was nothing to skip, and
    // reporting a skip would have the orchestrator claim it reused a build that
    // never existed.
    expect(await runDevBuildHooks()).toEqual({ success: true, logs: [], skipped: false });
  });

  it("reports a skip only when every routine skipped", async () => {
    registerDevBuildHook("flow", async () => ({ success: true, logs: [], skipped: true }));
    expect((await runDevBuildHooks()).skipped).toBe(true);

    // One routine doing real work makes the whole pass a rebuild.
    registerDevBuildHook("inertia", async () => ({ success: true, logs: [] }));
    expect((await runDevBuildHooks()).skipped).toBe(false);
  });
});

// ── Live-reload client ────────────────────────────────────────────────────────

describe("DEV_RELOAD_CLIENT", () => {
  /**
   * Run the injected snippet against a stub `WebSocket` and `location`, and
   * return handles to drive it: the sockets it opened, and the reload count.
   */
  function runClient() {
    const sockets: Array<{
      onmessage?: (e: { data: string }) => void;
      onclose?: () => void;
      close(): void;
    }> = [];
    let reloads = 0;

    const location = { protocol: "http:", host: "localhost:3000", reload: () => reloads++ };
    class FakeSocket {
      onmessage?: (e: { data: string }) => void;
      onclose?: () => void;
      constructor() {
        sockets.push(this);
      }
      close(): void {
        this.onclose?.();
      }
    }

    const body = DEV_RELOAD_CLIENT.replace(/^<script>/, "").replace(/<\/script>$/, "");
    new Function("location", "WebSocket", "setTimeout", body)(
      location,
      FakeSocket,
      // Reconnect immediately instead of after the real 1s backoff.
      (fn: () => void) => fn(),
    );

    return { sockets, reloads: () => reloads };
  }

  it("reloads on an explicit reload push", () => {
    const client = runClient();
    client.sockets[0]!.onmessage!({ data: "reload" });
    expect(client.reloads()).toBe(1);
  });

  it("does not reload when a reconnect reports the same build", () => {
    const client = runClient();
    client.sockets[0]!.onmessage!({ data: "version:abc" });
    client.sockets[0]!.close();
    client.sockets[1]!.onmessage!({ data: "version:abc" });
    expect(client.reloads()).toBe(0);
  });

  it("reloads when a reconnect reports a different build", () => {
    // A backend change rebuilds assets and restarts the worker. The restart kills
    // the socket, so a reload push at that moment reaches nobody — the changed
    // build token on reconnect is what gets the rebuild into the browser.
    const client = runClient();
    client.sockets[0]!.onmessage!({ data: "version:build-one" });
    client.sockets[0]!.close();
    client.sockets[1]!.onmessage!({ data: "version:build-two" });
    expect(client.reloads()).toBe(1);
  });

  it("ignores an empty build token rather than reloading on it", () => {
    const client = runClient();
    client.sockets[0]!.onmessage!({ data: "version:abc" });
    client.sockets[0]!.close();
    client.sockets[1]!.onmessage!({ data: "version:" });
    expect(client.reloads()).toBe(0);
  });

  it("reconnects when the socket closes, so a restart never wedges the page", () => {
    const client = runClient();
    expect(client.sockets).toHaveLength(1);
    client.sockets[0]!.close();
    expect(client.sockets).toHaveLength(2);
  });
});

// ── DevWsServer ───────────────────────────────────────────────────────────────

describe("DevWsServer", () => {
  const makeFakeWs = (failOnSend = false) => {
    const sent: string[] = [];
    return {
      data: {},
      send(msg: string) {
        if (failOnSend) throw new Error("send failed");
        sent.push(msg);
      },
      sent,
    };
  };

  afterEach(() => {
    // Clean up any clients added during tests
    // We can't directly clear the private set, so just close them
  });

  it("open() adds a client and broadcast() reaches it", () => {
    const ws = makeFakeWs();
    DevWsServer.open(ws);
    DevWsServer.broadcast("hello");
    expect(ws.sent).toContain("hello");
    DevWsServer.close(ws);
  });

  it("close() removes a client so broadcast() no longer reaches it", () => {
    const ws = makeFakeWs();
    DevWsServer.open(ws);
    DevWsServer.close(ws);
    DevWsServer.broadcast("hello");
    expect(ws.sent).toHaveLength(0);
  });

  it("broadcast() prunes stale sockets that throw on send", () => {
    const stale = makeFakeWs(true);
    const good = makeFakeWs(false);
    DevWsServer.open(stale);
    DevWsServer.open(good);
    // Should not throw even though stale.send() throws
    expect(() => DevWsServer.broadcast("reload")).not.toThrow();
    expect(good.sent).toContain("reload");
    // Clean up
    DevWsServer.close(good);
  });

  it("broadcast() with no clients is a no-op", () => {
    expect(() => DevWsServer.broadcast("ping")).not.toThrow();
  });
});

// ── CssPlugins ────────────────────────────────────────────────────────────────

describe("detectCssPlugins()", () => {
  it("returns an empty array when bun-plugin-tailwind is not installed", async () => {
    // In the test environment, bun-plugin-tailwind is not installed.
    const result = await detectCssPlugins(process.cwd());
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("returns the plugin when bun-plugin-tailwind resolves to a valid module", async () => {
    // Write a fake plugin module to a temp file
    const tmpPlugin = join(import.meta.dir, `_fake-tailwind-${Date.now()}.ts`);
    await Bun.write(tmpPlugin, 'export default { name: "fake-tailwind", setup() {} };\n');

    const origResolveSync = Bun.resolveSync;
    (Bun as unknown as Record<string, unknown>)["resolveSync"] = (id: string, cwd: string) =>
      id === "bun-plugin-tailwind" ? tmpPlugin : origResolveSync(id, cwd);

    try {
      const plugins = await detectCssPlugins(process.cwd());
      expect(plugins).toHaveLength(1);
      expect((plugins[0] as { name: string }).name).toBe("fake-tailwind");
    } finally {
      (Bun as unknown as Record<string, unknown>)["resolveSync"] = origResolveSync;
      await unlink(tmpPlugin).catch(() => {});
    }
  });
});

describe("buildCssBundle()", () => {
  let origSpawn: typeof Bun.spawn;
  let origResolveSync: typeof Bun.resolveSync;
  let origBuild: typeof Bun.build;

  beforeEach(() => {
    origSpawn = Bun.spawn;
    origResolveSync = Bun.resolveSync;
    origBuild = Bun.build;
  });

  afterEach(() => {
    (Bun as unknown as Record<string, unknown>)["spawn"] = origSpawn;
    (Bun as unknown as Record<string, unknown>)["resolveSync"] = origResolveSync;
    (Bun as unknown as Record<string, unknown>)["build"] = origBuild;
  });

  it("uses Bun.build() with the tailwind plugin when bun-plugin-tailwind is available", async () => {
    const tmpPlugin = join(import.meta.dir, `_fake-tailwind-build-${Date.now()}.ts`);
    await Bun.write(tmpPlugin, 'export default { name: "fake-tailwind", setup() {} };\n');

    const buildCalls: unknown[] = [];
    (Bun as unknown as Record<string, unknown>)["resolveSync"] = (id: string, cwd: string) =>
      id === "bun-plugin-tailwind" ? tmpPlugin : origResolveSync(id, cwd);
    (Bun as unknown as Record<string, unknown>)["build"] = async (opts: unknown) => {
      buildCalls.push(opts);
      return { success: true, outputs: [], logs: [] };
    };

    try {
      const result = await buildCssBundle("/app/resources/css/app.css", "/app/public/css");
      expect(result.success).toBe(true);
      expect(buildCalls).toHaveLength(1);
      const opts = buildCalls[0] as { entrypoints: string[]; plugins: unknown[] };
      expect(opts.entrypoints).toContain("/app/resources/css/app.css");
      expect(opts.plugins).toHaveLength(1);
    } finally {
      await unlink(tmpPlugin).catch(() => {});
    }
  });

  it("returns failure when spawn exits with non-zero code", async () => {
    (Bun as unknown as Record<string, unknown>)["spawn"] = (_args: string[], _opts?: unknown) => {
      const stderr = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("tailwind not found"));
          controller.close();
        },
      });
      return { exited: Promise.resolve(1), stderr } as ReturnType<typeof Bun.spawn>;
    };

    const result = await buildCssBundle("/fake/app.css", "/fake/public/css");
    expect(result.success).toBe(false);
    expect(Array.isArray(result.logs)).toBe(true);
  });

  it("returns success when spawn exits with code 0", async () => {
    (Bun as unknown as Record<string, unknown>)["spawn"] = (_args: string[], _opts?: unknown) => {
      const stderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      return { exited: Promise.resolve(0), stderr } as ReturnType<typeof Bun.spawn>;
    };

    const result = await buildCssBundle("/fake/app.css", "/fake/public/css");
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);
  });

  it("returns failure when spawn itself throws", async () => {
    (Bun as unknown as Record<string, unknown>)["spawn"] = () => {
      throw new Error("spawn error");
    };

    const result = await buildCssBundle("/fake/app.css", "/fake/public/css");
    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
  });
});
