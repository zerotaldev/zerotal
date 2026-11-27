import { describe, it, expect, beforeAll } from "bun:test";
import { Container, withApp } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { Component } from "./Component.ts";
import { expose, locked, can, getCanRules, getExposedMethods } from "./decorators.ts";
import { _actionRefusal } from "./authorize.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

/**
 * Exposing a method made it callable by anyone who could load the page, and the only place to
 * refuse a call was inside the action. `beforeAction()` runs before every exposed method, and
 * `@can` checks a policy ability through the app's Gate before the action body runs.
 */

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

interface Project {
  id: number;
  ownerId: number;
}

class ProjectPage extends Component {
  @locked project: Project = { id: 1, ownerId: 7 };
  @locked frozen = false;
  calls: string[] = [];

  @expose @can("update", (page: ProjectPage) => page.project) rename(): void {
    this.calls.push("rename");
  }

  @expose @can("view") @can("archive", (page: ProjectPage) => page.project) archive(): void {
    this.calls.push("archive");
  }

  @expose touch(): void {
    this.calls.push("touch");
  }

  override beforeAction(name: string, args: unknown[]): boolean {
    if (this.frozen) return false;
    if (args[0] === "boom") throw new Error(`no ${name} today`);
    return true;
  }

  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}

/** An app whose Gate allows exactly `allowed`, recording what it was asked. */
function appWithGate(allowed: Set<string>, asked: Array<[string, unknown]>): Application {
  const container = new Container();
  container.value("gate" as never, {
    allowsAsync: async (ability: string, model?: object) => {
      asked.push([ability, model]);
      return allowed.has(ability);
    },
  });
  return { container } as unknown as Application;
}

describe("@can", () => {
  it("does not expose a method by itself, and records its rules in the order written", () => {
    expect(getExposedMethods(ProjectPage).has("rename")).toBe(true);
    const rules = getCanRules(ProjectPage);
    expect(rules.get("rename")?.map((r) => r.ability)).toEqual(["update"]);
    expect(rules.get("archive")?.map((r) => r.ability)).toEqual(["view", "archive"]);
    expect(rules.has("touch")).toBe(false);
  });

  it("asks the Gate with the model read off the page, and lets an allowed call through", async () => {
    const page = new ProjectPage();
    const asked: Array<[string, unknown]> = [];
    const refusal = await withApp(appWithGate(new Set(["update"]), asked), () =>
      _actionRefusal(page, "rename", []),
    );
    expect(refusal).toBeNull();
    expect(asked).toEqual([["update", page.project]]);
  });

  it("refuses when the policy denies, without asking further rules", async () => {
    const asked: Array<[string, unknown]> = [];
    const refusal = await withApp(appWithGate(new Set(), asked), () =>
      _actionRefusal(new ProjectPage(), "archive", []),
    );
    expect(refusal?.why).toContain('denies "view"');
    expect(asked.map(([a]) => a)).toEqual(["view"]);
  });

  it("refuses, naming the fix, when no Gate is bound", async () => {
    const app = { container: new Container() } as unknown as Application;
    const refusal = await withApp(app, () => _actionRefusal(new ProjectPage(), "rename", []));
    expect(refusal?.error).toContain("AuthProvider");
  });
});

describe("beforeAction()", () => {
  it("lets a call through by default", async () => {
    expect(await _actionRefusal(new ProjectPage(), "touch", [])).toBeNull();
  });

  it("refuses when it returns false", async () => {
    const page = new ProjectPage();
    page.frozen = true;
    expect((await _actionRefusal(page, "touch", []))?.why).toContain("beforeAction() refused");
  });

  it("refuses when it throws, keeping the message for the log", async () => {
    const refusal = await _actionRefusal(new ProjectPage(), "touch", ["boom"]);
    expect(refusal?.error).toBe("no touch today");
  });

  it("runs after @can, so a denied policy never reaches it", async () => {
    const page = new ProjectPage();
    let reached = false;
    page.beforeAction = () => {
      reached = true;
      return true;
    };
    await withApp(appWithGate(new Set(), []), () => _actionRefusal(page, "rename", []));
    expect(reached).toBe(false);
  });
});
