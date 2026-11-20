/**
 * The doctor check with every peer installed. What it says when they are not is in
 * `peers.test.ts`, which runs it where none of them is.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Application } from "@zerotal/core";
import { _inertiaPeersCheck } from "./doctor.ts";

const appWith = (ssr: boolean): Application =>
  ({
    container: { makeSync: () => ({ get: (key: string) => key === "inertia.ssr" && ssr }) },
  }) as unknown as Application;

describe("the inertia-peers doctor check", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zt-inertia-doctor-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("has nothing to check for a client-rendered React app", async () => {
    expect(await _inertiaPeersCheck(root).run(appWith(false))).toEqual({
      status: "ok",
      message: "server rendering is off, and there is no .vue file.",
    });
  });

  it("passes a server-rendered React app with React and its adapter installed", async () => {
    expect(await _inertiaPeersCheck(root).run(appWith(true))).toEqual({
      status: "ok",
      message: "Server-rendered React pages: every package they need is installed.",
    });
  });

  it("checks for Vue when resources/ holds a .vue file", async () => {
    mkdirSync(join(root, "resources", "js", "pages"), { recursive: true });
    writeFileSync(join(root, "resources", "js", "pages", "Home.vue"), "<template/>\n");

    expect(await _inertiaPeersCheck(root).run(appWith(true))).toEqual({
      status: "ok",
      message: "Server-rendered Vue pages: every package they need is installed.",
    });
  }, 30_000);
});
