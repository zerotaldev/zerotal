import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Application } from "../application/Application.ts";
import { builtinDoctorChecks, runDoctor } from "./AppDoctor.ts";
import type { DoctorCheck } from "./AppDoctor.ts";

/** The checks read the app skeleton from process.cwd(), so each test gets its own. */
let root: string;
let previousCwd: string;
let previousAppKey: string | undefined;

beforeEach(() => {
  root = join(tmpdir(), `zt-doctor-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  previousCwd = process.cwd();
  process.chdir(root);
  previousAppKey = Bun.env["APP_KEY"];
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(root, { recursive: true, force: true });
  if (previousAppKey === undefined) delete Bun.env["APP_KEY"];
  else Bun.env["APP_KEY"] = previousAppKey;
});

/** Minimal Application stand-in with a controllable container and config. */
function fakeApp(
  options: {
    config?: Record<string, unknown>;
    bound?: string[];
    routedFiles?: string[];
    doctorChecks?: DoctorCheck[];
    /** Providers whose `doctorChecks()` the doctor should ask. */
    _activeProviders?: Array<{ doctorChecks?: () => DoctorCheck[] }>;
  } = {},
): Application {
  return {
    container: {
      makeSync: (key: string) => {
        if (key === "config") return { get: (k: string) => options.config?.[k] };
        throw new Error(`unbound: ${key}`);
      },
      bound: (key: string) => options.bound?.includes(key) ?? false,
    },
    routedFiles: options.routedFiles ?? [],
    doctorChecks: options.doctorChecks ?? [],
    // Deliberately left undefined when not supplied: `runDoctor` has to cope
    // with an app that predates the hook, and this is where that is exercised.
    ...(options._activeProviders ? { _activeProviders: options._activeProviders } : {}),
  } as unknown as Application;
}

function check(id: string): DoctorCheck {
  const found = builtinDoctorChecks.find((c) => c.id === id);
  if (!found) throw new Error(`no builtin check "${id}"`);
  return found;
}

describe("allowed-origins check", () => {
  const app = (config: Record<string, unknown>) => fakeApp({ config });

  it("fails on an empty list — the silent-403 configuration", async () => {
    const result = await check("allowed-origins").run(app({ "app.allowedOrigins": [] }));
    expect(result.status).toBe("fail");
    expect(result.message).toContain("403");
  });

  it("passes a configured public origin", async () => {
    const result = await check("allowed-origins").run(
      app({
        "app.url": "https://app.example.com",
        "app.allowedOrigins": ["https://app.example.com"],
      }),
    );
    expect(result.status).toBe("ok");
  });

  it("warns on an entry that is not an origin", async () => {
    // Inert rather than dangerous — but an inert entry is always a typo.
    const result = await check("allowed-origins").run(
      app({
        "app.url": "https://app.example.com",
        "app.allowedOrigins": ["https://app.example.com", "https://app.example.com/"],
      }),
    );
    expect(result.status).toBe("warn");
    expect(result.message).toContain("https://app.example.com/");
  });

  it("fails when production still points at localhost", async () => {
    const result = await check("allowed-origins").run(
      app({
        "app.env": "production",
        "app.url": "http://localhost:3000",
        "app.allowedOrigins": ["http://localhost:3000"],
      }),
    );
    expect(result.status).toBe("fail");
    expect(result.fix).toContain("APP_URL");
  });

  it("accepts localhost outside production", async () => {
    const result = await check("allowed-origins").run(
      app({
        "app.env": "development",
        "app.url": "http://localhost:3000",
        "app.allowedOrigins": ["http://localhost:3000"],
      }),
    );
    expect(result.status).toBe("ok");
  });
});

describe("boot-asset-writes check", () => {
  it("is quiet when nothing is bundled", async () => {
    const result = await check("boot-asset-writes").run(fakeApp({ config: {} }));
    expect(result.status).toBe("ok");
    expect(result.message).toContain("no bundled assets");
  });

  it("reports a writable output directory in production", async () => {
    const result = await check("boot-asset-writes").run(
      fakeApp({ config: { "app.env": "production", "app.assets": { outDir: "public" } } }),
    );
    expect(result.status).toBe("ok");
    expect(result.message).toContain("writable");
  });

  it("notices Flow's bundle directories from their entry points", async () => {
    mkdirSync(join(root, "resources/css"), { recursive: true });
    writeFileSync(join(root, "resources/css/app.css"), "");
    const result = await check("boot-asset-writes").run(
      fakeApp({ config: { "app.env": "development" } }),
    );
    expect(result.message).toContain("public/css");
  });
});

describe("app-key check", () => {
  it("warns when APP_KEY is not set", async () => {
    delete Bun.env["APP_KEY"];
    const result = await check("app-key").run(fakeApp());
    expect(result.status).toBe("warn");
    expect(result.fix).toContain("key:generate");
  });

  it("fails on a weak key and passes a strong one", async () => {
    Bun.env["APP_KEY"] = "secret";
    expect((await check("app-key").run(fakeApp())).status).toBe("fail");
    Bun.env["APP_KEY"] = "base64:" + Buffer.alloc(32, 7).toString("base64");
    expect((await check("app-key").run(fakeApp())).status).toBe("ok");
  });
});

describe("synchronize-vs-migrations check", () => {
  it("fails in production, where the deploy runs migrate", async () => {
    mkdirSync(join(root, "database", "migrations"), { recursive: true });
    writeFileSync(join(root, "database", "migrations", "0001_users.ts"), "");
    const app = fakeApp({
      config: { "database.synchronize": true, "app.env": "production" },
    });
    const result = await check("synchronize-vs-migrations").run(app);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("break the release");
  });

  it("warns rather than fails outside production", async () => {
    // Sync locally and migrations for the deploy is a documented arrangement —
    // the docs app itself is written that way, and `synchronize` is an expression
    // that is false in production. Failing it is how a check stops being trusted,
    // and this is the one the roadmap wants trusted enough to gate a deploy.
    mkdirSync(join(root, "database", "migrations"), { recursive: true });
    writeFileSync(join(root, "database", "migrations", "0001_users.ts"), "");
    const app = fakeApp({ config: { "database.synchronize": true, "app.env": "local" } });
    const result = await check("synchronize-vs-migrations").run(app);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("do not run");
  });

  it("passes with migrations only", async () => {
    mkdirSync(join(root, "database", "migrations"), { recursive: true });
    writeFileSync(join(root, "database", "migrations", "0001_users.ts"), "");
    const app = fakeApp({ config: { "database.synchronize": false } });
    expect((await check("synchronize-vs-migrations").run(app)).status).toBe("ok");
  });
});

describe("unrouted-routes check", () => {
  it("warns for an unrouted routes/ directory", async () => {
    mkdirSync(join(root, "routes"));
    writeFileSync(join(root, "routes", "index.ts"), "");
    const result = await check("unrouted-routes").run(fakeApp());
    expect(result.status).toBe("warn");
  });

  it("passes when a group covers it", async () => {
    mkdirSync(join(root, "routes"));
    writeFileSync(join(root, "routes", "index.ts"), "");
    const app = fakeApp({ routedFiles: [join(root, "routes", "index.ts")] });
    expect((await check("unrouted-routes").run(app)).status).toBe("ok");
  });
});

describe("provider-directory checks", () => {
  it("warns when app/schedules exists without the scheduler binding", async () => {
    mkdirSync(join(root, "app", "schedules"), { recursive: true });
    writeFileSync(join(root, "app", "schedules", "Sweep.ts"), "");
    const result = await check("schedules-provider").run(fakeApp());
    expect(result.status).toBe("warn");
    expect(result.fix).toContain("SchedulerProvider");
  });

  it("passes when the binding is present", async () => {
    mkdirSync(join(root, "app", "schedules"), { recursive: true });
    writeFileSync(join(root, "app", "schedules", "Sweep.ts"), "");
    const app = fakeApp({ bound: ["scheduler"] });
    expect((await check("schedules-provider").run(app)).status).toBe("ok");
  });

  it("warns when config/storage.ts exists without the storage binding", async () => {
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "config", "storage.ts"), "");
    const result = await check("storage-provider").run(fakeApp());
    expect(result.status).toBe("warn");
    expect(result.fix).toContain("StorageProvider");
  });
});

describe("runDoctor", () => {
  it("includes provider-contributed checks", async () => {
    const contributed: DoctorCheck = {
      id: "custom",
      label: "Custom",
      run: () => ({ status: "warn", message: "from a provider" }),
    };
    const report = await runDoctor(fakeApp({ doctorChecks: [contributed] }));
    const entry = report.find((e) => e.check.id === "custom");
    expect(entry?.result.message).toBe("from a provider");
  });

  it("reports a throwing check as that check's failure", async () => {
    const broken: DoctorCheck = {
      id: "broken",
      label: "Broken",
      run: () => {
        throw new Error("kaput");
      },
    };
    const report = await runDoctor(fakeApp(), [broken]);
    const entry = report.find((e) => e.check.id === "broken")!;
    expect(entry.result.status).toBe("fail");
    expect(entry.result.message).toContain("kaput");
  });
  it("includes checks a provider declares with doctorChecks()", async () => {
    // The declarative counterpart to registerDoctorCheck(): same report, but
    // the package lists its checks next to its other contributions.
    const provider: { doctorChecks: () => DoctorCheck[] } = {
      doctorChecks: () => [
        { id: "declared", label: "Declared", run: () => ({ status: "ok", message: "healthy" }) },
      ],
    };
    const report = await runDoctor(fakeApp({ _activeProviders: [provider] }));
    const entry = report.find((e) => e.check.id === "declared");
    expect(entry?.result.message).toBe("healthy");
  });

  it("ignores a provider whose doctorChecks() throws", async () => {
    // A broken contribution is not a finding about the app being checked, and
    // the doctor is what the user actually ran.
    const provider = {
      doctorChecks: () => {
        throw new Error("provider is broken");
      },
    };
    const report = await runDoctor(fakeApp({ _activeProviders: [provider] }));
    expect(report.length).toBeGreaterThan(0);
    expect(report.every((e) => !e.result.message.includes("provider is broken"))).toBe(true);
  });
});
