import { config } from "@zerotal/core";
import { GeneratorCommand } from "@zerotal/core/commands";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { generatePageRegistry } from "../PageRegistry.ts";
import { DEFAULT_PAGES_DIR } from "../config.ts";

/**
 * `make:page` — scaffold a new Inertia page component under the configured pages dir
 * and regenerate the page registry. The framework (React `.tsx` / Vue `.vue`) is
 * auto-detected from the installed adapter unless forced with `--framework`.
 *
 * The page is written the way the starters write theirs: a named component, a `Props`
 * interface with the `title` every starter route passes, `<Head>` for the document title,
 * and the app's signed-in layout (`AppLayout`, found beside the pages directory) as its
 * persistent layout. Pass `--layout` to name another, or `--layout none` for no layout. The
 * file is formatted with the app's own Prettier, so it passes the app's `format:check`.
 *
 * With `--route` it also writes the file route that renders the page, so the page is served
 * without writing anything by hand: `GET` at the page's own path (`tasks/index` → `/tasks`),
 * under `app/routes/(auth)/(verified)/` when the app has that group, as the starters' signed-in
 * pages are. `--path` serves it somewhere else, `projects/[project]/edit` for instance.
 *
 * @category Scaffolding
 * @example
 * ```ts
 * // bun zt make:page tasks/index
 * // bun zt make:page tasks/index --route
 * // bun zt make:page tasks/edit --path "tasks/[task]/edit"
 * // bun zt make:page Dashboard --layout PublicLayout
 * // bun zt make:page Settings --framework vue
 * ```
 */
export class MakePageCommand extends GeneratorCommand {
  static override commandName = "make:page";
  static override description = "Create a new Inertia page component";
  static override needsApp = false;
  // As Inertia.render() names it: `tasks/index`, `auth/forgot-password`.
  static override nameKind = "path" as const;

  static override args = [
    {
      name: "name",
      required: true,
      description: "Page name, as Inertia.render() names it, e.g. tasks/index",
    },
  ];

  static override flags = [
    {
      name: "layout",
      type: "string" as const,
      description:
        "The persistent layout, e.g. --layout PublicLayout (default: AppLayout when the app has one; none for no layout)",
      default: "",
    },
    {
      name: "framework",
      type: "string" as const,
      description: "Force the frontend framework: 'vue' or 'react' (auto-detected by default)",
      default: "",
    },
    {
      name: "route",
      type: "boolean" as const,
      description: "Also write the GET route that renders the page, at the page's own path",
      default: false,
    },
    {
      name: "path",
      type: "string" as const,
      description:
        'Write the route at this path instead, e.g. --path "tasks/[task]/edit" (implies --route)',
      default: "",
    },
  ];

  override async run(): Promise<void> {
    // A Windows path or a stray slash is still the same page; tidied before the base checks it.
    this.args["name"] = (this.args["name"] ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    await super.run();
  }

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const pagesDir = config
      .safe("inertia.pagesDir", DEFAULT_PAGES_DIR)
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");

    // Pick the framework: explicit --framework flag, else auto-detect from the
    // installed Inertia adapter (@inertiajs/vue3 → vue, otherwise react).
    const forced = (this.flags["framework"] as string | undefined)?.toLowerCase() ?? "";
    const framework: Framework =
      forced === "vue" || forced === "react"
        ? (forced as Framework)
        : _detectFramework(process.cwd());
    const ext = framework === "vue" ? "vue" : "tsx";

    const path = `${pagesDir}/${name}.${ext}`;

    if (!(await this.canWrite(path))) return;

    const asked = ((this.flags["layout"] as string | undefined) ?? "").trim();
    const layoutName = asked === "" ? "AppLayout" : asked;
    const layoutFile =
      asked.toLowerCase() === "none" ? undefined : _findLayout(pagesDir, layoutName, ext);
    if (asked !== "" && asked.toLowerCase() !== "none" && !layoutFile) {
      this.warn(`  No ${layoutName}.${ext} beside ${pagesDir}/; the page has no layout.`);
    }

    const stub = _pageStub({
      framework,
      component: _componentName(name),
      layout: layoutFile
        ? { name: layoutName, from: _importPath(path, layoutFile, framework) }
        : undefined,
    });

    if (!(await this.writeFile(path, stub))) return;
    if (layoutFile) this.dim(`  Layout: ${layoutName}, from ${layoutFile}`);

    const askedPath = ((this.flags["path"] as string | undefined) ?? "").trim();
    if (this.flags["route"] === true || askedPath !== "") {
      await this._writeRoute(name, askedPath);
    } else {
      this.dim(`  Render it from a route: Inertia.render("${name}", { title: "…" })`);
      this.dim(`  Or run this again with --route to write that route too.`);
    }

    if (this.dryRun) {
      this.dim("  Would regenerate the page registry.");
      return;
    }
    this.dim("  Regenerating page registry...");
    await generatePageRegistry(process.cwd());
    this.info("Page registry updated.");
  }

  /** Write the file route that renders the page, unless one already serves that path. */
  private async _writeRoute(page: string, askedPath: string): Promise<void> {
    // Where the starters' `fileBasedRouting()` points, and where AGENTS.md says routes live.
    const target = _routeFile("app/routes", page, askedPath, (dir) => existsSync(dir));
    if (!this.force && (await Bun.file(target.file).exists())) {
      this.warn(`  A route already serves ${target.url}: ${target.file}. It was left alone.`);
      return;
    }
    if (!(await this.writeFile(target.file, _routeStub(page, target.url)))) return;
    this.dim(
      `  GET ${target.url} renders the page${target.group ? `, behind ${target.group}` : ""}.`,
    );
    this.dim("  Run `bun zt route:types` so route() knows its name.");
  }
}

/** Where a page's route goes, and the URL it serves. @internal */
export interface _RouteTarget {
  /** The route file, relative to the app root. */
  file: string;
  /** The URL path it serves, with `:param` for a `[param]` segment. */
  url: string;
  /** The group folder it sits in, e.g. `(auth)/(verified)`, or `""` for none. */
  group: string;
}

/**
 * The route file for a page: at `askedPath` when given, else at the page's own path, inside the
 * signed-in group the starters keep their pages in when the app has one.
 *
 * `tasks/index` is served at `/tasks`, `reports/monthly` at `/reports/monthly`. A path is taken
 * as written, `[param]` segments included; a leading `/` and a `.ts` are dropped.
 *
 * @param routesDir - The app's file-routes directory, e.g. `app/routes`.
 * @param page - The page name, as `Inertia.render()` names it.
 * @param askedPath - The `--path` flag, or `""`.
 * @param exists - Whether a directory exists, relative to the app root.
 * @internal Exported for tests.
 */
export function _routeFile(
  routesDir: string,
  page: string,
  askedPath: string,
  exists: (dir: string) => boolean,
): _RouteTarget {
  const path = (askedPath || page)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.ts$/, "");
  const group = ["(auth)/(verified)", "(auth)"].find((g) => exists(`${routesDir}/${g}`)) ?? "";
  const file = `${routesDir}/${group ? `${group}/` : ""}${path}.ts`;
  const segments = path
    .split("/")
    .filter((segment) => segment !== "index")
    .map((segment) => segment.replace(/^\[(.+)\]$/, ":$1"));
  return { file, url: `/${segments.join("/")}`, group };
}

/**
 * The route's source: `GET` renders the page with the `title` its props interface asks for.
 *
 * @internal Exported for tests.
 */
export function _routeStub(page: string, url: string): string {
  const words = page.split("/").filter((word) => word !== "index");
  const last = words.at(-1) ?? "Home";
  const title = last.charAt(0).toUpperCase() + last.slice(1).replace(/[-_]+/g, " ");
  return `import { Inertia } from "@zerotal/inertia";

// GET ${url}
export const GET = () => Inertia.render("${page}", { title: "${title}" });
`;
}

type Framework = "vue" | "react";

/**
 * Detect the frontend framework from the Inertia adapter installed in `cwd`.
 *
 * @internal Shared with `make:route` and `make:resource`.
 */
export function _detectFramework(cwd: string): Framework {
  try {
    Bun.resolveSync("@inertiajs/vue3", cwd);
    return "vue";
  } catch {
    return "react";
  }
}

/**
 * `tasks/index` → `TasksIndex`, `settings/two-factor` → `SettingsTwoFactor`: a component
 * name from the page's path, PascalCase, as the starters name theirs. A lone `index` was the
 * component's name before, which reads as nothing in a stack trace or in devtools.
 *
 * @internal Exported for tests.
 */
export function _componentName(page: string): string {
  const words = page
    .split(/[/\\\-_.\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const joined = words.join("").replace(/[^A-Za-z0-9]/g, "");
  if (joined === "") return "Page";
  return /^[0-9]/.test(joined) ? `Page${joined}` : joined;
}

/**
 * The layout's file, relative to the app root, without extension for React: looked for in
 * `Layouts/` and `layouts/` beside the pages directory, as the starters keep them.
 *
 * @internal Shared with `make:route`.
 */
export function _findLayout(pagesDir: string, layout: string, ext: string): string | undefined {
  const root = dirname(pagesDir);
  for (const dir of ["Layouts", "layouts"]) {
    const file = join(root, dir, `${layout}.${ext}`).replace(/\\/g, "/");
    if (existsSync(file)) return file;
  }
  return undefined;
}

/**
 * A relative import from the page at `from` to `to`; React's has no extension, Vue's keeps it.
 *
 * @internal Shared with `make:route`.
 */
export function _importPath(from: string, to: string, framework: Framework): string {
  const target = framework === "react" ? to.replace(/\.tsx$/, "") : to;
  const path = relative(dirname(from), target).replace(/\\/g, "/");
  return path.startsWith(".") ? path : `./${path}`;
}

/** What a page stub is built from. @internal */
export interface _PageStubOptions {
  framework: Framework;
  /** The component's name, e.g. `TasksIndex`. */
  component: string;
  /** The persistent layout and the import that reaches it, or none. */
  layout: { name: string; from: string } | undefined;
}

/**
 * The page's source. Double quotes, a named component and a `Props` interface with the
 * `title` the starters' routes pass, and the layout as Inertia's persistent layout.
 *
 * @internal Exported for tests.
 */
export function _pageStub(o: _PageStubOptions): string {
  return o.framework === "vue" ? _vueStub(o) : _reactStub(o);
}

function _reactStub({ component, layout }: _PageStubOptions): string {
  const imports = [
    ...(layout ? [`import type { ReactNode } from "react";`] : []),
    `import { Head } from "@inertiajs/react";`,
    ...(layout ? [`import ${layout.name} from "${layout.from}";`] : []),
  ].join("\n");
  const body = `<>
      <Head title={title} />
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
    </>`;
  return `${imports}

/** The props the route passes to \`Inertia.render()\`. */
interface Props {
  title: string;
}

function ${component}({ title }: Props) {
  return (
    ${body}
  );
}
${
  layout
    ? `
// The layout persists across visits: only the page re-renders.
${component}.layout = (page: ReactNode) => <${layout.name}>{page}</${layout.name}>;
`
    : ""
}
export default ${component};
`;
}

function _vueStub({ component, layout }: _PageStubOptions): string {
  const imports = [
    `import { Head } from "@inertiajs/vue3";`,
    ...(layout ? [`import ${layout.name} from "${layout.from}";`] : []),
  ].join("\n");
  const options = layout
    ? `{ name: "${component}", layout: ${layout.name} }`
    : `{ name: "${component}" }`;
  return `<script setup lang="ts">
${imports}

${layout ? "// The layout persists across visits: only the page re-renders.\n" : ""}defineOptions(${options});

/** The props the route passes to \`Inertia.render()\`. */
defineProps<{
  title: string;
}>();
</script>

<template>
  <Head :title="title" />
  <h1 class="text-2xl font-bold tracking-tight">{{ title }}</h1>
</template>
`;
}
