import { describe, it, expect, afterEach } from "bun:test";
import { Component } from "./Component.ts";
import { registerPage, getPage, _getPageEntries } from "./registry.ts";

/**
 * Pages are found by class name, so a second page class with the same name takes over the
 * first one's actions. That is an app's mistake, and it is now said out loud.
 */
const warned: string[] = [];
const originalWarn = console.warn;

afterEach(() => {
  console.warn = originalWarn;
  warned.length = 0;
  _getPageEntries().delete("CollidingIndex");
});

function capture(): void {
  console.warn = (...args: unknown[]) => void warned.push(args.map(String).join(" "));
}

function pageNamed(name: string): typeof Component {
  const holder = {
    [name]: class extends Component {
      override async render() {
        return { html: "" };
      }
    },
  };
  return holder[name] as unknown as typeof Component;
}

describe("two page classes with one name", () => {
  it("warns once, naming both routes", () => {
    capture();
    registerPage("/projects", pageNamed("CollidingIndex"));
    registerPage("/tasks", pageNamed("CollidingIndex"));
    registerPage("/tasks", pageNamed("CollidingIndex"));

    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('Two page classes are named "CollidingIndex"');
    expect(warned[0]).toContain("/projects");
    expect(warned[0]).toContain("/tasks");
  });

  it("does not warn for the same class registered again, or a fresh copy at the same path", () => {
    capture();
    const First = pageNamed("CollidingIndex");
    registerPage("/projects", First);
    registerPage("/projects", First);
    registerPage("/projects", pageNamed("CollidingIndex"));

    expect(warned).toEqual([]);
    expect(getPage("CollidingIndex")?.path).toBe("/projects");
  });
});
