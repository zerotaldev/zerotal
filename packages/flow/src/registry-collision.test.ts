import { describe, it, expect, afterEach } from "bun:test";
import { Component } from "./Component.ts";
import { registerPage, getPage, _getPageEntries, FlowPageNameCollisionError } from "./registry.ts";

/**
 * Pages are found by class name, so a second page class with the same name would take over the
 * first one's actions. That is an app's mistake, and registration refuses it.
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
  it("is an error at registration, naming both routes", () => {
    const First = pageNamed("CollidingIndex");
    registerPage("/projects", First);

    let thrown: unknown;
    try {
      registerPage("/tasks", pageNamed("CollidingIndex"));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FlowPageNameCollisionError);
    const message = (thrown as Error).message;
    expect(message).toContain('Two page classes are named "CollidingIndex"');
    expect(message).toContain("/projects");
    expect(message).toContain("/tasks");
    // The first page keeps its actions: nothing was swapped in before the refusal.
    expect(getPage("CollidingIndex")?.PageClass).toBe(First);
  });

  it("allows the same class registered again, or a fresh copy at the same path", () => {
    capture();
    const First = pageNamed("CollidingIndex");
    registerPage("/projects", First);
    registerPage("/projects", First);
    registerPage("/projects", pageNamed("CollidingIndex"));

    expect(warned).toEqual([]);
    expect(getPage("CollidingIndex")?.path).toBe("/projects");
  });
});
