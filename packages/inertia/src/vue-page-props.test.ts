/**
 * A Vue page's props are checked against `Inertia.render`, as a React page's are.
 *
 * `vue-tsc` types a `<script setup>` page as `DefineComponent<Props, …>`. That is a
 * constructor whose parameters are `...args: any[]`, so reading the props off its
 * first parameter — which is right for a React class component — inferred `any`,
 * and every Vue controller compiled whatever it passed: a missing prop, a number
 * for a string. The props are on the instance's `$props`, which is where they are
 * read now.
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
      files: ["controllers.ts"],
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Vue page props", () => {
  it("are checked against the props the page declares", async () => {
    const tsc = Bun.spawn(
      [process.execPath, join(PKG, "node_modules", "typescript", "bin", "tsc"), "-p", dir],
      { stdout: "pipe", stderr: "pipe" },
    );
    const out = (await new Response(tsc.stdout).text()) + (await new Response(tsc.stderr).text());
    await tsc.exited;

    const wrong = CONTROLLERS.split("\n")
      .map((line, i) => (line.includes("// WRONG") ? i + 1 : 0))
      .filter((n) => n > 0);
    const reported = [...out.matchAll(/controllers\.ts\((\d+),\d+\): error/g)].map((m) =>
      Number(m[1]),
    );
    expect({ reported: [...new Set(reported)], other: out.includes("pages.ts(") }).toEqual({
      reported: wrong,
      other: false,
    });
  }, 60_000);
});
