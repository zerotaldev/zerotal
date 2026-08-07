import { describe, it, expect } from "bun:test";
import { servicesConcern } from "./builtinConcerns.ts";
import type { ConcernContext } from "./ConventionLoader.ts";
import { Container } from "../container/Container.ts";
import { inject } from "../container/inject.ts";

function contextFor(container: Container): ConcernContext {
  return {
    app: { container } as never,
    env: "test",
    resolve: () => undefined,
  };
}

describe("servicesConcern", () => {
  it("registers a singleton service so make() returns the same instance", async () => {
    const container = new Container();
    class SingletonService {
      static lifetime = "singleton" as const;
    }

    await servicesConcern.register!({ SingletonService }, contextFor(container));

    const a = await container.make(SingletonService as never);
    const b = await container.make(SingletonService as never);
    expect(a).toBeInstanceOf(SingletonService);
    expect(a).toBe(b);
  });

  it("registers a scoped service (resolves within a request scope)", async () => {
    const container = new Container();
    class ScopedService {
      static lifetime = "scoped" as const;
    }

    await servicesConcern.register!({ ScopedService }, contextFor(container));

    await container.runScoped(async () => {
      const a = await container.make(ScopedService as never);
      const b = await container.make(ScopedService as never);
      expect(a).toBe(b); // same instance within the scope
    });
  });

  it("does not register classes without a lifetime (auto-wire still works)", async () => {
    const container = new Container();
    @inject()
    class PlainService {}

    await servicesConcern.register!({ PlainService }, contextFor(container));

    expect(container.registry.has(PlainService)).toBe(false);
    // Still resolvable on demand via auto-wiring, but a fresh instance each time.
    const a = await container.make(PlainService as never);
    const b = await container.make(PlainService as never);
    expect(a).not.toBe(b);
  });

  it("ignores non-class exports (types, constants)", async () => {
    const container = new Container();
    await servicesConcern.register!({ SOME_CONST: 42, helper: "string" }, contextFor(container));
    expect(container.registry.size).toBe(0);
  });
});
