/**
 * The anthropic driver against the real `@anthropic-ai/sdk`, not a stub.
 *
 * Every other driver test injects a client built to `anthropic-sdk.ts`, which pins how the
 * driver uses those shapes and says nothing about whether the SDK still has them. The SDK is a
 * devDependency of this package so that this file can ask, and so that the bundle tests below
 * have a real package to embed.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Application } from "@zerotal/core";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import { _loadAnthropicSdk } from "./AnthropicDriver.ts";
import type { AnthropicConstructor } from "./anthropic-sdk.ts";
import { _providerSdkCheck } from "../doctor.ts";
import { AiDriverUnavailableError } from "../errors.ts";

describe("loading @anthropic-ai/sdk", () => {
  it("finds the constructor and the error classes the driver maps by class", async () => {
    const { default: Anthropic } = await _loadAnthropicSdk();

    for (const name of [
      "RateLimitError",
      "APIConnectionError",
      "AuthenticationError",
      "NotFoundError",
      "BadRequestError",
      "APIError",
    ] as const) {
      expect(typeof Anthropic[name]).toBe("function");
    }
  });

  it("builds a client with both messages namespaces the driver calls", async () => {
    const { default: Anthropic } = await _loadAnthropicSdk();
    const client = new Anthropic({ apiKey: "test-key", timeout: 1_000 });

    for (const api of [client.messages, client.beta.messages]) {
      expect(typeof api.create).toBe("function");
      expect(typeof api.stream).toBe("function");
    }
    expect(typeof client.messages.countTokens).toBe("function");
  });

  it("carries the error classes the structural type declares, by type as well as at run time", async () => {
    const real = (await import("@anthropic-ai/sdk")).default;
    // A compile-time check as much as a runtime one: if the SDK drops or renames one of the error
    // classes, `typecheck:tests` fails on this line. (`Omit` keeps the static properties and
    // leaves out the constructor, whose parameters the SDK types far more tightly than the loose
    // records this package builds requests from.)
    const statics: Omit<AnthropicConstructor, never> = real;
    expect(statics.RateLimitError).toBe(real.RateLimitError);
  });
});

describe("the SDK in a bundle, as a compiled app runs it", () => {
  async function run(args: string[], cwd?: string): Promise<string> {
    const proc = Bun.spawn([process.execPath, ...args], {
      ...(cwd === undefined ? {} : { cwd }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`bun ${args.join(" ")} exited ${code}: ${err}`);
    return out;
  }

  async function bundleAndRun(external: string[]): Promise<Record<string, unknown>> {
    // Outside the repository, so a bundle that left the SDK external cannot find it in a
    // node_modules above it, just as a compiled binary deployed without it cannot.
    const outdir = mkdtempSync(join(tmpdir(), "zerotal-ai-sdk-bundle-"));
    try {
      // `bun build` in a child rather than `Bun.build()`: on Bun 1.3.14 for Windows a second
      // `Bun.build()` in one process fails to read files the first one read.
      await run([
        "build",
        `${import.meta.dir}/__fixtures__/anthropic-sdk-bundled.ts`,
        "--target=bun",
        `--outfile=${join(outdir, "app.js")}`,
        ...external.map((name) => `--external=${name}`),
      ]);
      // `--no-install`: with no node_modules in sight Bun would otherwise fetch the package
      // from its global cache, which a compiled binary never does.
      const out = await run(["--no-install", join(outdir, "app.js")], outdir);
      return JSON.parse(out.trim().split("\n").at(-1)!) as Record<string, unknown>;
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  }

  it("embeds the SDK when it is installed at build time", async () => {
    expect(await bundleAndRun([])).toEqual({ loaded: "function", rateLimitError: "function" });
  }, 60_000);

  it("names the missing SDK when the app was built without it", async () => {
    expect(await bundleAndRun(["@anthropic-ai/sdk"])).toEqual({
      threw: "AiDriverUnavailableError",
      code: "E_AI_DRIVER_UNAVAILABLE",
      cause: "E_OPTIONAL_PEER_MISSING",
    });
  }, 60_000);
});

describe("the ai-provider-sdk doctor check", () => {
  function appWith(drivers: Record<string, unknown> | null): Application {
    const ai = drivers === null ? undefined : { config: { drivers } };
    return { container: { tryMake: () => ai } } as unknown as Application;
  }

  const installed = async (): Promise<void> => {};
  const missing = async (): Promise<never> => {
    const error = new AiDriverUnavailableError("anthropic", "@anthropic-ai/sdk");
    error.cause = new OptionalPeerMissingError({
      peer: "@anthropic-ai/sdk",
      feature: 'The AI driver "anthropic"',
      install: "bun add @anthropic-ai/sdk",
    });
    throw error;
  };
  const broken = async (): Promise<never> => {
    throw new Error("Cannot find package 'standardwebhooks'");
  };

  it("passes when the anthropic driver is configured and the SDK loads", async () => {
    const result = await _providerSdkCheck(installed).run(appWith({ anthropic: {} }));
    expect(result.status).toBe("ok");
  });

  it("fails, with the install command, when the SDK is missing", async () => {
    const result = await _providerSdkCheck(missing).run(appWith({ anthropic: {} }));
    expect(result).toMatchObject({ status: "fail", fix: "bun add @anthropic-ai/sdk" });
    expect(result.message).toContain("drivers.anthropic");
  });

  it("reports an SDK that is installed but broken as broken, not as missing", async () => {
    const result = await _providerSdkCheck(broken).run(appWith({ anthropic: {} }));
    expect(result.status).toBe("fail");
    expect(result.message).toContain("did not load");
    expect(result.message).toContain("standardwebhooks");
  });

  it("does not ask for the SDK when no driver needs it", async () => {
    for (const app of [appWith({ ollama: {} }), appWith(null)]) {
      expect((await _providerSdkCheck(missing).run(app)).status).toBe("ok");
    }
  });
});
