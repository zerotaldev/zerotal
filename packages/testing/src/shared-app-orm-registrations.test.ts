/**
 * Every test file sees the ORM registrations the app made, not only the first.
 *
 * Global scopes, lifecycle hooks and observers live on the active `OrmContext`.
 * `createTestApp()` resets that context and re-adopts the shared app, which installs a
 * fresh one, so what the app registered while it booted (a tenancy scope, observers
 * from `app/observers/`) and what a model registered when its module was evaluated
 * (the `Roles` mixin's eager-load scope) was gone in every file after the first. A
 * tenant-scoped query returned every tenant's rows under `bun zt test` and the right
 * ones under `--isolate`, so it read as a flaky test rather than a harness bug.
 *
 * What a *test* registers is still its own: a hook added inside one file is not
 * carried into the next.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { Application, ServiceProvider } from "@zerotal/core";
import { BaseModel, currentOrmContext } from "@zerotal/orm";
import { createTestApp, type TestApp } from "./TestApp.ts";

/** A model whose class body registers a scope, the way the `Roles` mixin does. */
class Invoice extends BaseModel {
  static override table = "invoices";
  static {
    this.addGlobalScope("defined-with-the-class", () => {});
  }
}

/** Registers a scope while the app boots, the way `TenancyProvider` does. */
class ScopeProvider extends ServiceProvider {
  override async onBooted(): Promise<void> {
    Invoice.addGlobalScope("registered-at-boot", () => {});
  }
}

let cached: Application | undefined;
function bootstrap(): Application {
  cached ??= Application.create({ env: "test", providers: [ScopeProvider] }).useConfig({});
  return cached;
}

const scopes = (): string[] =>
  [...(currentOrmContext().globalScopes.get(Invoice)?.keys() ?? [])].sort();

let first: TestApp | undefined;
let second: TestApp | undefined;

afterAll(async () => {
  for (const app of [second, first]) {
    if (app) app._shared = false;
  }
  await second?.close();
  if (first !== second) await first?.close();
  Application._resetInstance();
  cached = undefined;
});

describe("createTestApp — ORM registrations across test files", () => {
  it("are there in the first file", async () => {
    first = await createTestApp(bootstrap);
    expect(scopes()).toEqual(["defined-with-the-class", "registered-at-boot"]);

    // A test of its own adds one, which must stay in this file.
    Invoice.addGlobalScope("added-by-a-test", () => {});
    await first.close();
  });

  it("are still there in the next file, without what the first file's tests added", async () => {
    second = await createTestApp(bootstrap);
    expect(second).toBe(first!);
    expect(scopes()).toEqual(["defined-with-the-class", "registered-at-boot"]);
  });
});
