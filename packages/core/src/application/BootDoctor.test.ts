import { describe, it, expect } from "bun:test";
import { Container } from "../container/Container.ts";
import { ServiceProvider } from "../provider/ServiceProvider.ts";
import type { Application } from "./Application.ts";
import { runBootDoctor, BootCheckError } from "./BootDoctor.ts";

// Register test-only tokens so `static provides` and container calls type-check.
declare module "../container/types.ts" {
  interface ContainerBindings {
    "doctor.good": string;
    "doctor.missing": string;
    "doctor.throwing": string;
    "doctor.deferred": string;
  }
}

const fakeApp = {} as Application;

class GoodProvider extends ServiceProvider {
  static override provides = ["doctor.good"] as const;
}
class MissingProvider extends ServiceProvider {
  static override provides = ["doctor.missing"] as const;
}
class ThrowingProvider extends ServiceProvider {
  static override provides = ["doctor.throwing"] as const;
}
class DeferredProvider extends ServiceProvider {
  static override provides = ["doctor.deferred"] as const;
}
class NoProvidesProvider extends ServiceProvider {}

describe("Container.bound / isDeferred", () => {
  it("bound() is true for a registered binding, false otherwise, without constructing", () => {
    const c = new Container();
    let built = 0;
    c.singleton("doctor.good", () => (built++, "G"));
    expect(c.bound("doctor.good")).toBe(true);
    expect(c.bound("doctor.missing")).toBe(false);
    expect(built).toBe(0); // bound() never runs the factory
  });

  it("isDeferred() is true only for a deferred token", () => {
    const c = new Container();
    c.singleton("doctor.good", () => "G");
    c.defer("doctor.deferred", DeferredProvider as never);
    expect(c.isDeferred("doctor.good")).toBe(false);
    expect(c.isDeferred("doctor.deferred")).toBe(true);
    expect(c.bound("doctor.deferred")).toBe(true); // deferred counts as bound
  });
});

describe("runBootDoctor", () => {
  it("passes when every declared token is bound", async () => {
    const c = new Container();
    c.value("doctor.good", "G");
    await expect(
      runBootDoctor([new GoodProvider(fakeApp)], c, { eagerResolve: true }),
    ).resolves.toBeUndefined();
  });

  it("throws — even without eager resolution — when a declared token is unbound", async () => {
    const c = new Container();
    let error: BootCheckError | undefined;
    try {
      await runBootDoctor([new MissingProvider(fakeApp)], c, { eagerResolve: false });
    } catch (e) {
      error = e as BootCheckError;
    }
    expect(error).toBeInstanceOf(BootCheckError);
    expect(error!.failures).toHaveLength(1);
    expect(error!.failures[0]!.token).toBe("doctor.missing");
    expect(error!.failures[0]!.provider).toBe("MissingProvider");
    expect(error!.message).toContain("doctor.missing");
    expect(error!.code).toBe("E_BOOT_CHECK_FAILED");
  });

  it("surfaces a construction error as a named failure when eager-resolving", async () => {
    const c = new Container();
    c.singleton("doctor.throwing", () => {
      throw new Error("boom while building");
    });
    let error: BootCheckError | undefined;
    try {
      await runBootDoctor([new ThrowingProvider(fakeApp)], c, { eagerResolve: true });
    } catch (e) {
      error = e as BootCheckError;
    }
    expect(error).toBeInstanceOf(BootCheckError);
    expect(error!.failures[0]!.token).toBe("doctor.throwing");
    expect(error!.failures[0]!.reason).toContain("boom while building");
  });

  it("does NOT construct a bound token when eager resolution is off", async () => {
    const c = new Container();
    let built = 0;
    c.singleton("doctor.throwing", () => {
      built++;
      throw new Error("should not run");
    });
    await expect(
      runBootDoctor([new ThrowingProvider(fakeApp)], c, { eagerResolve: false }),
    ).resolves.toBeUndefined();
    expect(built).toBe(0);
  });

  it("verifies a deferred token as bound but never eager-resolves it", async () => {
    const c = new Container();
    c.defer("doctor.deferred", DeferredProvider as never);
    // Deferred bindings are respected: the doctor passes without booting the provider.
    await expect(
      runBootDoctor([new DeferredProvider(fakeApp)], c, { eagerResolve: true }),
    ).resolves.toBeUndefined();
  });

  it("skips providers that declare no `provides`", async () => {
    const c = new Container();
    await expect(
      runBootDoctor([new NoProvidesProvider(fakeApp)], c, { eagerResolve: true }),
    ).resolves.toBeUndefined();
  });

  it("aggregates every failure into one error", async () => {
    const c = new Container();
    c.singleton("doctor.throwing", () => {
      throw new Error("boom");
    });
    let error: BootCheckError | undefined;
    try {
      await runBootDoctor([new MissingProvider(fakeApp), new ThrowingProvider(fakeApp)], c, {
        eagerResolve: true,
      });
    } catch (e) {
      error = e as BootCheckError;
    }
    expect(error!.failures).toHaveLength(2);
    expect(error!.failures.map((f) => f.token).sort()).toEqual([
      "doctor.missing",
      "doctor.throwing",
    ]);
  });
});
