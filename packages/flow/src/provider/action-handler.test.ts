/**
 * The action handler, driven the way the socket and the HTTP fallback drive it: one raw frame
 * in, the frames it would send out.
 *
 * Every refusal the handler can make is here, because none of them was tested and three of them
 * were wrong. Ten bad frames from one address refused every later frame from it, valid or not.
 * A frame with no snapshot threw out of the handler. An action that threw told nobody: no log
 * line, no call to the app's exception handler, and an event that said it had gone well.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { Application, Container, FrameworkEvents, ForbiddenError, abort } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import { Component } from "../Component.ts";
import { expose, locked } from "../decorators.ts";
import { dehydrate } from "../dehydrate.ts";
import { registerPage, _getPageEntries } from "../registry.ts";
import { FlowActionHandled } from "../frameworkEvents.ts";
import { _GENERIC_ERROR_MESSAGE } from "../errorText.ts";
import {
  _asCallFrame,
  _handleFlowMessage,
  _noteInvalidFrame,
  _resetInvalidFrames,
} from "./FlowProvider.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

type Frame = Record<string, unknown>;
type Deps = Parameters<typeof _handleFlowMessage>[2];
type Socket = Parameters<typeof _handleFlowMessage>[0];

/** What the page under test did, so a test can say what ran. */
let ran: string[] = [];

class LedgerPage extends Component {
  @locked balance = 100;
  @expose note = "";
  @expose breakRender = false;
  @expose rethrow = false;

  @expose async deposit(): Promise<void> {
    ran.push("deposit");
    this.balance += 1;
  }

  @expose async failLoudly(): Promise<void> {
    throw new Error(
      "SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email (db=/srv/prod.sqlite)",
    );
  }

  @expose async failForbidden(): Promise<void> {
    throw new ForbiddenError("You cannot close another team's ledger.");
  }

  @expose async failAborted(): Promise<void> {
    abort(409, "That ledger is already closed.");
  }

  @expose async breakTheRender(): Promise<void> {
    this.breakRender = true;
  }

  /** Never exposed: the browser may not call it. */
  async wipe(): Promise<void> {
    ran.push("wipe");
  }

  override async onError(error: Error): Promise<void> {
    if (this.rethrow) throw error;
    await super.onError(error);
  }

  override async render() {
    if (this.breakRender) throw new Error("connect ECONNREFUSED 10.0.0.12:5432 user=app_rw");
    return { html: `<p>${this.balance}</p>` };
  }
}

function socket(ip = "203.0.113.7"): { ws: Socket; frames: Frame[] } {
  const frames: Frame[] = [];
  const ws = {
    data: { origin: "http://localhost", headers: new Headers(), remoteIp: ip },
    send(message: string): void {
      frames.push(JSON.parse(message) as Frame);
    },
  };
  return { ws: ws as unknown as Socket, frames };
}

async function snapshotOf(
  overrides: Partial<LedgerPage> = {},
): Promise<ReturnType<typeof dehydrate>> {
  const page = new LedgerPage();
  Object.assign(page, overrides);
  page._flowId = "ledger-1";
  page._flowPath = "/ledger";
  await page.onBoot();
  return dehydrate(page, { id: "ledger-1", name: "LedgerPage", path: "/ledger" });
}

function call(method: string, snapshot: unknown, extra: Frame = {}): string {
  return JSON.stringify({
    type: "call",
    component: "ledger-1",
    method,
    args: [],
    updates: {},
    snapshot,
    ...extra,
  });
}

/** Log lines written while a test runs. No app is current, so they go to stdout. */
let logged: string[] = [];
const writeOut = process.stdout.write.bind(process.stdout);

/** Errors handed to the app's exception handler, standing in for `Application._reportError`. */
let reported: unknown[] = [];
let middlewareAsked = 0;

function deps(): Deps {
  return {
    container: new Container(),
    globalMiddleware: () => {
      middlewareAsked++;
      return [];
    },
    report: async (error: unknown, _ctx: HttpContext) => {
      reported.push(error);
    },
  };
}

let events: FlowActionHandled[] = [];
let stopListening: (() => void) | undefined;
const savedEnv = {
  NODE_ENV: Bun.env.NODE_ENV,
  APP_ENV: Bun.env.APP_ENV,
  ZT_APP_ENV: Bun.env.ZT_APP_ENV,
};

/** Run as a deployment does: no test flag, a production environment name. */
function asProduction(): void {
  Bun.env.NODE_ENV = "production";
  Bun.env.APP_ENV = "production";
  delete Bun.env.ZT_APP_ENV;
}

beforeEach(() => {
  Application._resetInstance();
  _resetInvalidFrames();
  _getPageEntries().delete("LedgerPage");
  registerPage("/ledger", LedgerPage);
  ran = [];
  logged = [];
  reported = [];
  events = [];
  middlewareAsked = 0;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    logged.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;
  const off = FrameworkEvents.on(FlowActionHandled, (e: FlowActionHandled) => void events.push(e));
  stopListening = typeof off === "function" ? off : undefined;
});

afterEach(() => {
  process.stdout.write = writeOut;
  stopListening?.();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
});

const errorOf = (frames: Frame[]): Frame | undefined => frames.find((f) => f["type"] === "error");
const patchOf = (frames: Frame[]): Frame | undefined => frames.find((f) => f["type"] === "patch");
const flashOf = (frames: Frame[]): Frame | undefined => frames.find((f) => f["type"] === "flash");
const warnings = (): string[] => logged.filter((line) => /WARN/i.test(line));

describe("a frame that is not a call frame", () => {
  it("is refused, not thrown, when the snapshot is missing", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, '{"type":"call"}', deps());

    expect(errorOf(frames)?.["message"]).toBe("Malformed frame");
  });

  it.each([
    ["no memo", { data: {}, checksum: "x" }],
    ["a memo with no name", { data: {}, checksum: "x", memo: { id: "a", path: "/" } }],
    ["data that is an array", { data: [], checksum: "x", memo: { id: "a", name: "A", path: "/" } }],
    ["no checksum", { data: {}, memo: { id: "a", name: "A", path: "/" } }],
    [
      "children that are not a list",
      { data: {}, checksum: "x", memo: { id: "a", name: "A", path: "/", children: "nope" } },
    ],
  ])("is refused with %s", async (_label, snapshot) => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("deposit", snapshot), deps());

    expect(errorOf(frames)?.["message"]).toBe("Malformed frame");
    expect(middlewareAsked).toBe(0);
  });

  it.each(["null", "[]", '"call"', "42", "not json", '{"type":"ping"}'])(
    "is ignored when the message is %s",
    async (raw) => {
      const { ws, frames } = socket();

      await _handleFlowMessage(ws, raw, deps());

      expect(frames).toEqual([]);
    },
  );

  it("ignores a cancel with no component instead of throwing", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, '{"type":"call","method":"$cancel"}', deps());

    expect(frames).toEqual([]);
  });

  it("reads a frame with no updates or args as having none", () => {
    const frame = _asCallFrame({
      type: "call",
      component: "a",
      method: "go",
      snapshot: { data: {}, checksum: "x", memo: { id: "a", name: "A", path: "/" } },
    });

    expect(frame?.updates).toEqual({});
    expect(frame?.args).toEqual([]);
  });
});

describe("a snapshot that does not verify", () => {
  it("is refused before any middleware runs", async () => {
    const forged = { ...(await snapshotOf()), checksum: "f".repeat(64) };
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("deposit", forged), deps());

    expect(errorOf(frames)?.["message"]).toBe("Invalid snapshot");
    expect(middlewareAsked).toBe(0);
    expect(ran).toEqual([]);
    expect(events).toEqual([]);
  });

  it("gets the same answer whatever page it names, so the reply confirms no guess", async () => {
    const forged = await snapshotOf();
    forged.memo.name = "NoSuchPageAnywhere";
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("deposit", forged), deps());

    expect(errorOf(frames)?.["message"]).toBe("Invalid snapshot");
  });

  it("does not stop a valid frame from the same address being served", async () => {
    const good = await snapshotOf();
    const forged = { ...good, checksum: "f".repeat(64) };
    for (let i = 0; i < 25; i++) {
      await _handleFlowMessage(socket().ws, call("deposit", forged), deps());
    }

    const { ws, frames } = socket();
    await _handleFlowMessage(ws, call("deposit", good), deps());

    expect(errorOf(frames)).toBeUndefined();
    expect(String(patchOf(frames)?.["html"])).toContain("<p>101</p>");
    expect(ran).toEqual(["deposit"]);
  });

  it("is answered differently past the limit, and stops being logged", async () => {
    const forged = { ...(await snapshotOf()), checksum: "f".repeat(64) };
    const answers: unknown[] = [];
    for (let i = 0; i < 14; i++) {
      const { ws, frames } = socket();
      await _handleFlowMessage(ws, call("deposit", forged), deps());
      answers.push(errorOf(frames)?.["message"]);
    }

    expect(answers.slice(0, 10)).toEqual(Array(10).fill("Invalid snapshot"));
    expect(answers.slice(10)).toEqual(Array(4).fill("Too many invalid requests"));
    // Ten refusals, then one line saying the rest are refused quietly. Not fourteen.
    expect(warnings()).toHaveLength(11);
    expect(warnings()[10]).toContain("Frames that verify are still served");
    expect(warnings()[10]).toContain("trustedProxies");
  });

  it("counts each address on its own", async () => {
    const forged = { ...(await snapshotOf()), checksum: "f".repeat(64) };
    for (let i = 0; i < 12; i++) {
      await _handleFlowMessage(socket("198.51.100.1").ws, call("deposit", forged), deps());
    }

    const { ws, frames } = socket("198.51.100.2");
    await _handleFlowMessage(ws, call("deposit", forged), deps());

    expect(errorOf(frames)?.["message"]).toBe("Invalid snapshot");
  });

  it("starts a fresh count when the window has passed", () => {
    const start = 1_000_000;
    for (let i = 0; i < 11; i++) _noteInvalidFrame("192.0.2.9", "test", start);
    expect(_noteInvalidFrame("192.0.2.9", "test", start + 1)).toBe(true);

    expect(_noteInvalidFrame("192.0.2.9", "test", start + 601_000)).toBe(false);
  });
});

describe("a snapshot that verifies", () => {
  it("answers Unknown component when the server no longer has the class", async () => {
    const good = await snapshotOf();
    _getPageEntries().delete("LedgerPage");
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("deposit", good), deps());

    // The browser reloads on this exact message; a restart is what it usually means.
    expect(errorOf(frames)?.["message"]).toBe("Unknown component");
  });

  it("runs the action and says so", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("deposit", await snapshotOf()), deps());

    expect(String(patchOf(frames)?.["html"])).toContain("<p>101</p>");
    expect(events.map((e) => e.ok)).toEqual([true]);
    expect(reported).toEqual([]);
  });

  it("refuses a method that is not exposed, logs it and reports the call as failed", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("wipe", await snapshotOf()), deps());

    expect(errorOf(frames)?.["message"]).toBe('Method "wipe" is not allowed');
    expect(ran).toEqual([]);
    expect(events.map((e) => e.ok)).toEqual([false]);
    expect(warnings().join("")).toContain('Refused a call to "wipe" on LedgerPage');
  });
});

describe("an action that throws", () => {
  it("is reported to the app's exception handler and marks the event as failed", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("failLoudly", await snapshotOf()), deps());

    expect(reported).toHaveLength(1);
    expect(String((reported[0] as Error).message)).toContain("SQLITE_CONSTRAINT");
    expect(events.map((e) => e.ok)).toEqual([false]);
    expect(logged.join("")).toContain('An error was thrown by action "failLoudly" on LedgerPage');
    // The page is still repainted, and told the action failed.
    expect(patchOf(frames)?.["actionError"]).toBe(true);
  });

  it("is logged with its stack when there is no application to report to", async () => {
    const bare = deps();
    delete bare.report;
    const { ws } = socket();

    await _handleFlowMessage(ws, call("failLoudly", await snapshotOf()), bare);

    expect(logged.join("")).toContain("SQLITE_CONSTRAINT");
  });

  it("shows the error's own message in a test run", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("failLoudly", await snapshotOf()), deps());

    expect(String(flashOf(frames)?.["message"])).toContain("SQLITE_CONSTRAINT");
  });

  it("shows a generic message in production, and keeps the detail off the wire", async () => {
    asProduction();
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("failLoudly", await snapshotOf()), deps());

    expect(flashOf(frames)?.["message"]).toBe(_GENERIC_ERROR_MESSAGE);
    expect(JSON.stringify(frames)).not.toContain("SQLITE_CONSTRAINT");
    expect(JSON.stringify(frames)).not.toContain("prod.sqlite");
    expect(reported).toHaveLength(1);
  });

  it("keeps the message of an error raised to answer the client, in production too", async () => {
    asProduction();
    const first = socket();
    await _handleFlowMessage(first.ws, call("failForbidden", await snapshotOf()), deps());
    const second = socket();
    await _handleFlowMessage(second.ws, call("failAborted", await snapshotOf()), deps());

    expect(flashOf(first.frames)?.["message"]).toBe("You cannot close another team's ledger.");
    expect(flashOf(second.frames)?.["message"]).toBe("That ledger is already closed.");
    // An answer to the client is not a fault: no Flow error line for it.
    expect(logged.join("")).not.toContain("An error was thrown by");
  });

  it("falls back to the default flash when onError() hands the error back", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(
      ws,
      call("failForbidden", await snapshotOf({ rethrow: true })),
      deps(),
    );

    expect(flashOf(frames)?.["message"]).toBe("You cannot close another team's ledger.");
  });
});

describe("an error thrown outside the action body", () => {
  it("is reported, marks the event as failed, and shows its message in a test run", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("breakTheRender", await snapshotOf()), deps());

    expect(String(errorOf(frames)?.["message"])).toContain("ECONNREFUSED");
    expect(reported).toHaveLength(1);
    expect(events.map((e) => e.ok)).toEqual([false]);
  });

  it("sends a generic message in production", async () => {
    asProduction();
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("breakTheRender", await snapshotOf()), deps());

    expect(errorOf(frames)?.["message"]).toBe(_GENERIC_ERROR_MESSAGE);
    expect(JSON.stringify(frames)).not.toContain("ECONNREFUSED");
    expect(errorOf(frames)?.["stack"]).toBeUndefined();
  });
});
