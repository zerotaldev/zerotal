/**
 * A Vue page's props can be checked against `Inertia.render`, as a React page's are.
 *
 * `vue-tsc` types a `<script setup>` page as `DefineComponent<Props, …>`. That is a
 * constructor whose parameters are `...args: any[]`, so reading the props off its
 * first parameter — which is right for a React class component — inferred `any`,
 * and every Vue controller compiled whatever it passed: a missing prop, a number
 * for a string. With `InertiaTypeOptions.checkVueProps` they are read from the
 * instance's `$props`. Off by default in 1.18, because turning it on can fail a
 * `vue-tsc` that passed; without it nothing changes, which the second case holds.
 *
 * Compiled for real, because the question is what TypeScript says: a throwaway
 * project maps `@zerotal/inertia` to the registry types, declares the pages the way
 * `vue-tsc` and a `*.vue` shim type them, and `tsc` must report exactly the calls
 * marked wrong. It sits inside this package so `vue` resolves from its devDependencies.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const PKG = join(import.meta.dir, "..");
let dir: string;

const PAGES = `
import type { DefineComponent } from "vue";

/** What vue-tsc makes of \`defineProps<{ title: string; emailVerified: boolean }>()\`. */
declare const Profile: DefineComponent<{ title: string; emailVerified: boolean }>;
/** A page with an optional prop. */
declare const Sessions: DefineComponent<{ title: string; current?: number | undefined }>;
/** A page that declares no props. */
declare const About: DefineComponent<{}>;
/** What a \`declare module "*.vue"\` shim gives every page under plain tsc. */
declare const Shimmed: DefineComponent<{}, {}, any>;

export const pages = {
  "settings/profile": () => Promise.resolve({ default: Profile }),
  "settings/sessions": () => Promise.resolve({ default: Sessions }),
  about: () => Promise.resolve({ default: About }),
  legacy: () => Promise.resolve({ default: Shimmed }),
};

declare module "@zerotal/inertia" {
  interface InertiaPageRegistry {
    pages: typeof pages;
  }
}
`;

const CONTROLLERS = `
import type { PageTarget, RenderArgs } from "@zerotal/inertia";
import "./pages.ts";

declare function render<N extends PageTarget>(component: N, ...args: RenderArgs<N>): void;

// Right: every declared prop, each of its type.
render("settings/profile", { title: "Profile", emailVerified: true });
render("settings/sessions", { title: "Sessions" });
render("settings/sessions", { title: "Sessions", current: 3 });
render("about");
// A shimmed page has no props TypeScript can see, so it keeps accepting any.
render("legacy", { anything: 1 });

render("settings/profile", { title: 42, emailVerified: true }); // WRONG: title
render("settings/profile", { title: "Profile" }); // WRONG: emailVerified missing
render("settings/profile", { title: "Profile", emailVerified: true, extra: 1 }); // WRONG: extra
render("settings/sessions", { title: "Sessions", current: "3" }); // WRONG: current
`;

const OPT_IN = `
declare module "@zerotal/inertia" {
  interface InertiaTypeOptions {
    checkVueProps: true;
  }
}
export {};
`;

/** Write the project, with or without the opt-in, and the lines `tsc` reports. */
async function compile(optIn: boolean): Promise<{ reported: number[]; other: boolean }> {
  await Bun.write(join(dir, "options.ts"), optIn ? OPT_IN : "export {};\n");
  const tsc = Bun.spawn(
    [process.execPath, join(PKG, "node_modules", "typescript", "bin", "tsc"), "-p", dir],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = (await new Response(tsc.stdout).text()) + (await new Response(tsc.stderr).text());
  await tsc.exited;
  const reported = [...out.matchAll(/controllers\.ts\((\d+),\d+\): error/g)].map((m) =>
    Number(m[1]),
  );
  return {
    reported: [...new Set(reported)],
    other: [...out.matchAll(/^\S*?([\w-]+\.ts)\(\d+,\d+\): error/gm)].some(
      (m) => m[1] !== "controllers.ts",
    ),
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(PKG, ".tmp-vue-props-"));
  await Bun.write(join(dir, "pages.ts"), PAGES);
  await Bun.write(join(dir, "controllers.ts"), CONTROLLERS);
  await Bun.write(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        noEmit: true,
        strict: true,
        exactOptionalPropertyTypes: true,
        skipLibCheck: true,
        types: [],
        paths: { "@zerotal/inertia": [join(PKG, "src", "pages.ts")] },
      },
      files: ["options.ts", "controllers.ts"],
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Vue page props", () => {
  it("are checked against the props the page declares, once the app opts in", async () => {
    const wrong = CONTROLLERS.split("\n")
      .map((line, i) => (line.includes("// WRONG") ? i + 1 : 0))
      .filter((n) => n > 0);
    expect(await compile(true)).toEqual({ reported: wrong, other: false });
  }, 60_000);

  it("are not checked without the opt-in, so a patch upgrade fails no build", async () => {
    expect(await compile(false)).toEqual({ reported: [], other: false });
  }, 60_000);
});
