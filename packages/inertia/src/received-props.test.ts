/**
 * A test reads a page's props with the types its component declares.
 *
 * Reading `page.props["projects"]` off a test response gives `unknown`, so every
 * starter test cast it to the shape it expected, and a prop renamed in the component
 * kept compiling in the test that read the old name. `inertiaProps()` returns
 * `ReceivedProps<N>`, read from the same generated registry that checks
 * `Inertia.render(N, props)` in a controller.
 *
 * Compiled for real, because the question is what TypeScript says: a throwaway project
 * maps `@zerotal/inertia` to the registry types, declares pages the way a React
 * component and `vue-tsc` type them, and `tsc` must report exactly the lines marked
 * wrong.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const PKG = join(import.meta.dir, "..");
let dir: string;

const PAGES = `
import type { DefineComponent } from "vue";

interface Project { id: number; name: string }

/** A React function component, as a page module's default export. */
declare function ProjectsIndex(props: {
  projects: Project[];
  pagination: { page: number; total: number };
  setup: { secret: string } | null;
}): unknown;

/** What vue-tsc makes of \`defineProps<{ sessions: { current: boolean }[] }>()\`. */
declare const Sessions: DefineComponent<{ sessions: { current: boolean }[] }>;

export const pages = {
  "projects/index": () => Promise.resolve({ default: ProjectsIndex }),
  "settings/sessions": () => Promise.resolve({ default: Sessions }),
};

declare module "@zerotal/inertia" {
  interface InertiaPageRegistry {
    pages: typeof pages;
  }
  interface SharedProps {
    auth: { user: { id: number; name: string } | null };
  }
  interface InertiaTypeOptions {
    checkVueProps: true;
  }
}
`;

const TESTS = `
import type { PageTarget, ReceivedProps } from "@zerotal/inertia";
import "./pages.ts";

declare function inertiaProps<N extends PageTarget>(response: unknown, component: N): ReceivedProps<N>;

const { projects, pagination, setup } = inertiaProps({}, "projects/index");
const names: string[] = projects.map((p) => p.name);
const total: number = pagination.total;
const secret: string | undefined = setup?.secret;
// Shared props: the app's own, and the ones the framework always merges.
const user: { name: string } | null = inertiaProps({}, "projects/index").auth.user;
const success: string | null = inertiaProps({}, "projects/index").flash.success;
// A Vue page, read from \`$props\` once the app checks Vue props.
const current: boolean[] = inertiaProps({}, "settings/sessions").sessions.map((s) => s.current);

const { project } = inertiaProps({}, "projects/index"); // WRONG: no such prop
const id: string = projects[0]!.id; // WRONG: id is a number
inertiaProps({}, "projects/show"); // WRONG: no such page
inertiaProps({}, "settings/sessions").session; // WRONG: no such prop

export { names, total, secret, user, success, current, project, id };
`;

/** The lines `tsc` reports in the test file, and whether anything else failed. */
async function compile(): Promise<{ reported: number[]; other: boolean }> {
  const tsc = Bun.spawn(
    [process.execPath, join(PKG, "node_modules", "typescript", "bin", "tsc"), "-p", dir],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = (await new Response(tsc.stdout).text()) + (await new Response(tsc.stderr).text());
  await tsc.exited;
  const reported = [...out.matchAll(/tests\.ts\((\d+),\d+\): error/g)].map((m) => Number(m[1]));
  return {
    reported: [...new Set(reported)],
    other: [...out.matchAll(/^\S*?([\w-]+\.ts)\(\d+,\d+\): error/gm)].some(
      (m) => m[1] !== "tests.ts",
    ),
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(PKG, ".tmp-received-props-"));
  await Bun.write(join(dir, "pages.ts"), PAGES);
  await Bun.write(join(dir, "tests.ts"), TESTS);
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
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        types: [],
        paths: { "@zerotal/inertia": [join(PKG, "src", "pages.ts")] },
      },
      files: ["tests.ts"],
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ReceivedProps", () => {
  it("types a page's props from its component, so a wrong name or type fails to compile", async () => {
    const wrong = TESTS.split("\n")
      .map((line, i) => (line.includes("// WRONG") ? i + 1 : 0))
      .filter((n) => n > 0);
    expect(await compile()).toEqual({ reported: wrong, other: false });
  }, 60_000);
});
