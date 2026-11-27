import { Command, config } from "@zerotal/core";
import {
  _frameworkImport,
  _readModel,
  _relativeImport,
  _writeAppSource,
} from "@zerotal/core/commands";
import { existsSync, readFileSync } from "node:fs";
import { generatePageRegistry } from "../PageRegistry.ts";
import { DEFAULT_PAGES_DIR } from "../config.ts";
import { _refreshRouteTypes } from "../scaffold/resource.ts";
import {
  _componentName,
  _detectFramework,
  _findLayout,
  _importPath,
  _pageStub,
} from "./MakePageCommand.ts";

/**
 * `make:route` — write a file route under `app/routes/`, in the starters' style: a `GET` that
 * renders its Inertia page and a `POST` that validates, flashes and redirects. The path is the
 * file's path under `app/routes/`, groups and parameters included, so
 * `make:route "(auth)/reports/[report]/export"` serves `/reports/:report/export` behind the
 * `(auth)` group's middleware.
 *
 * A `[param]` that names a model (`[task]` → `Task`) arrives as the loaded record, and when the
 * app has that model's policy the route authorizes against it. The page the `GET` renders is
 * written too when the app has none by that name, and the page registry and route types are
 * regenerated, so the route typechecks as soon as it is written.
 *
 * @category Scaffolding
 * @example
 * ```ts
 * // bun zt make:route reports
 * // bun zt make:route "(auth)/(verified)/tasks/[task]/archive" --methods POST
 * // bun zt make:route "(auth)/billing" --methods GET --page settings/billing
 * ```
 */
export class MakeRouteCommand extends Command {
  static override commandName = "make:route";
  static override description = "Create a file route under app/routes/ (and the page it renders)";
  static override needsApp = false;

  static override args = [
    {
      name: "path",
      required: true,
      description: 'Its path under app/routes/, e.g. reports or "(auth)/tasks/[task]/archive"',
    },
  ];

  static override flags = [
    {
      name: "methods",
      type: "string" as const,
      description: "The handlers to export, comma-separated: GET, POST, PUT, PATCH, DELETE",
      default: "GET,POST",
    },
    {
      name: "page",
      type: "string" as const,
      description: "The page GET renders (default: the path without groups and parameters)",
      default: "",
    },
    {
      name: "framework",
      type: "string" as const,
      description: "Force the page's framework: 'vue' or 'react' (auto-detected by default)",
      default: "",
    },
  ];

  override async run(): Promise<void> {
    const path = _routePath(this.args["path"]!);
    if (path === "") {
      this.error("Name the route, e.g. `bun zt make:route reports`.");
      process.exitCode = 1;
      return;
    }
    const bad = _badSegment(path);
    if (bad !== undefined) {
      this.error(
        `"${bad}" is not a route segment. Use letters, digits, - and _ in a name, ` +
          "(group) for a group, and [param] or [...param] for a parameter (letters, digits and _).",
      );
      process.exitCode = 1;
      return;
    }
    const file = `app/routes/${path}.ts`;
    const taken = _sameRouteFiles(path).find((f) => existsSync(f));
    if (taken !== undefined) {
      this.error(`${taken} already serves ${_urlOf(path)}.`);
      process.exitCode = 1;
      return;
    }

    const asked = String(this.flags["methods"] ?? "GET,POST")
      .split(",")
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean);
    const unknown = asked.filter((m) => !(VERBS as readonly string[]).includes(m));
    if (unknown.length > 0 || asked.length === 0) {
      this.error(`--methods takes ${VERBS.join(", ")}; not ${unknown.join(", ") || "nothing"}.`);
      process.exitCode = 1;
      return;
    }
    const methods = VERBS.filter((m) => asked.includes(m));

    const pagesDir = config
      .safe("inertia.pagesDir", DEFAULT_PAGES_DIR)
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
    const pageFlag = String(this.flags["page"] ?? "").replace(/^\/+|\/+$/g, "");
    const page = methods.includes("GET") ? pageFlag || _pageName(path) : undefined;

    const params = _params(path).map((name) => {
      const model = _readModel(_pascal(name));
      return {
        name,
        model,
        policy: model !== undefined && existsSync(`app/policies/${_pascal(name)}Policy.ts`),
      };
    });

    const source = _routeSource({
      file,
      url: _urlOf(path),
      methods,
      page,
      title: _titleOf(path),
      params,
      appImport: (to) =>
        _appAliased() && to.startsWith("app/") ? `@${to}` : _relativeImport(file, to),
      specifiers: {
        core: _frameworkImport("@zerotal/core"),
        auth: _frameworkImport("@zerotal/auth"),
        validator: _frameworkImport("@zerotal/validator"),
      },
      rejectInput: existsSync("app/support/validation.ts"),
    });
    await _writeAppSource(file, source);
    this.info(`Created: ${file}`);

    if (page) {
      const forced = String(this.flags["framework"] ?? "").toLowerCase();
      const framework =
        forced === "vue" || forced === "react" ? forced : _detectFramework(process.cwd());
      const ext = framework === "vue" ? "vue" : "tsx";
      const pageFile = `${pagesDir}/${page}.${ext}`;
      if (existsSync(pageFile)) {
        this.dim(`  It renders ${pageFile}, which is already there.`);
      } else {
        const layoutFile = _findLayout(pagesDir, "AppLayout", ext);
        await _writeAppSource(
          pageFile,
          _pageStub({
            framework,
            component: _componentName(page),
            layout: layoutFile
              ? { name: "AppLayout", from: _importPath(pageFile, layoutFile, framework) }
              : undefined,
          }),
        );
        this.info(`Created: ${pageFile}`);
      }
      await generatePageRegistry(process.cwd(), pagesDir);
    }

    if (await _refreshRouteTypes(process.cwd())) this.dim("  Route types updated.");
    else this.warn("  Run `bun zt route:types`, so route() knows the new route.");
    this.info(`Serves ${_urlOf(path)} (${methods.join(", ")}).`);
  }
}

/** The verbs a file route exports, in the order the generated file lists them. */
const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Verb = (typeof VERBS)[number];

/** Whether the app's tsconfig maps `@app/*`, as the starters' does. */
function _appAliased(): boolean {
  try {
    return readFileSync("tsconfig.json", "utf8").includes('"@app/*"');
  } catch {
    return false;
  }
}

/**
 * `app/routes/reports.ts`, `/reports/` or `reports` → `reports`: the path under `app/routes/`,
 * without the extension.
 *
 * @internal Exported for tests.
 */
export function _routePath(input: string): string {
  return input
    .replace(/\\/g, "/")
    .replace(/^\.?\/+/, "")
    .replace(/^app\/routes\//, "")
    .replace(/\.tsx?$/, "")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * The first segment of `path` that is not a name, a `(group)` or a `[param]`, or undefined when
 * every one is. `.` and `..` are refused, so the route cannot be written outside `app/routes/`,
 * and a parameter must be an identifier, since the route reads it as `http.params.<name>`.
 *
 * @internal Exported for tests.
 */
export function _badSegment(path: string): string | undefined {
  return path
    .split("/")
    .find(
      (s) =>
        !/^[A-Za-z0-9_-]+$/.test(s) &&
        !/^\([A-Za-z0-9_-]+\)$/.test(s) &&
        !/^\[(?:\.\.\.)?[A-Za-z_][A-Za-z0-9_]*\]$/.test(s),
    );
}

/**
 * The files that would serve the same URL as `app/routes/<path>.ts`: `reports` and
 * `reports/index` are one route, in either extension.
 *
 * @internal Exported for tests.
 */
export function _sameRouteFiles(path: string): string[] {
  const base = path.endsWith("/index") ? path.slice(0, -"/index".length) : path;
  const stems = path === "index" ? ["index"] : [base, `${base}/index`];
  return stems.flatMap((s) => [`app/routes/${s}.ts`, `app/routes/${s}.tsx`]);
}

/** The segments that serve a URL: groups `(auth)` add none. */
function segments(path: string): string[] {
  return path.split("/").filter((s) => s !== "" && !/^\(.*\)$/.test(s));
}

/**
 * The URL a route file serves: groups dropped, `[param]` as `:param`, a trailing `index` the
 * directory itself.
 *
 * @internal Exported for tests.
 */
export function _urlOf(path: string): string {
  const parts = segments(path).map((s) => s.replace(/^\[(?:\.\.\.)?(.+)\]$/, ":$1"));
  if (parts[parts.length - 1] === "index") parts.pop();
  return "/" + parts.join("/");
}

/**
 * The page a route renders, named as the starters name theirs: the path without groups and
 * parameters, so `(auth)/projects/[project]/edit` renders `projects/edit`.
 *
 * @internal Exported for tests.
 */
export function _pageName(path: string): string {
  const parts = segments(path).filter((s) => !/^\[.*\]$/.test(s));
  return parts.join("/") || "home";
}

/** The `[param]` names in a path, in order. */
function _params(path: string): string[] {
  return segments(path).flatMap((s) => {
    const m = /^\[(?:\.\.\.)?(.+)\]$/.exec(s);
    return m ? [m[1]!] : [];
  });
}

function _pascal(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** `(auth)/monthly-reports/index` → `Monthly reports`. */
function _titleOf(path: string): string {
  const named = segments(path).filter((s) => !/^\[.*\]$/.test(s) && s !== "index");
  const last = named[named.length - 1] ?? "Home";
  const words = last.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a route file is built from. @internal */
export interface _RouteSourceOptions {
  file: string;
  url: string;
  methods: readonly Verb[];
  /** The page GET renders; absent without a GET. */
  page: string | undefined;
  title: string;
  /** Each `[param]`, the model it binds when one is named after it, and whether it has a policy. */
  params: { name: string; model: { file: string } | undefined; policy: boolean }[];
  /** The specifier the route imports an app module (no extension) by. */
  appImport: (to: string) => string;
  specifiers: { core: string; auth: string; validator: string };
  /** The app has the starters' `rejectInput()` helper in `app/support/validation.ts`. */
  rejectInput: boolean;
}

/**
 * The route file's source.
 *
 * @internal Exported for tests.
 */
export function _routeSource(o: _RouteSourceOptions): string {
  const bound = o.params.filter((p) => p.model !== undefined);
  const paramType =
    o.params.length > 0
      ? `<{ ${o.params.map((p) => `${p.name}: ${p.model ? _pascal(p.name) : "string"}`).join("; ")} }>`
      : "";
  const ctx = `http: HttpContext${paramType}`;
  const authorizes = bound.some((p) => p.policy);
  const validates = o.methods.some((m) => m === "POST" || m === "PUT" || m === "PATCH");
  // `validate(http, …)` takes a plain context, and one whose params are loaded models is not
  // one; a FormRequest reads the request on its own, as the starters' model routes do.
  const formRequest = validates && bound.length > 0;
  // Where a write sends the visitor: back to this page, with each parameter filled in.
  const back = o.params.length
    ? `\`${o.url.replace(/:([A-Za-z_$][\w$-]*)/g, (_, name: string) => {
        const p = o.params.find((x) => x.name === name);
        return p?.model ? `\${http.params.${name}.id}` : `\${http.params.${name}}`;
      })}\``
    : `"${o.url}"`;

  const imports = [
    `import type { HttpContext } from "${o.specifiers.core}";`,
    ...(o.page ? [`import { Inertia } from "@zerotal/inertia";`] : []),
    ...(authorizes ? [`import { Gate } from "${o.specifiers.auth}";`] : []),
    ...(validates && !formRequest ? [`import { validate } from "${o.specifiers.validator}";`] : []),
    ...(formRequest
      ? [
          `import { FormRequest } from "${o.specifiers.validator}";`,
          `import type { RuleBuilder } from "${o.specifiers.validator}";`,
        ]
      : []),
    ...bound.map((p) => `import type { ${_pascal(p.name)} } from "${o.appImport(p.model!.file)}";`),
  ];

  const authorize = (ability: string) =>
    bound
      .filter((p) => p.policy)
      .map((p) => `  Gate.authorize("${ability}", http.params.${p.name});\n`)
      .join("");

  const handlers = o.methods.map((verb) => {
    if (verb === "GET") {
      const binding = bound.length
        ? `\n//\n// ${bound.map((p) => `\`:${p.name}\``).join(" and ")} ${bound.length > 1 ? "arrive" : "arrives"} as the loaded model (a 404 when there is none).`
        : "";
      return `// GET ${o.url}${binding}
export const GET = async (${o.params.length || authorizes ? ctx : ""}) => {
${authorize("view")}  return Inertia.render("${o.page}", {
    title: "${o.title}",
  });
};`;
    }
    if (verb === "DELETE") {
      return `// DELETE ${o.url}
export async function DELETE(${ctx}): Promise<void> {
${authorize("delete")}  // Do the work here, then redirect: answering with a redirect is what keeps a refresh
  // from sending the request again.
  http.flash("success", "Deleted.");
  http.redirect(${back}, 303);
}`;
    }
    return `// ${verb} ${o.url}
export async function ${verb}(${ctx}): Promise<void> {
${authorize("update")}  // On failure this throws: the visitor is sent back to the form with the errors and
  // what they typed. Below this line \`name\` is valid and a string.
  const { name } = await ${
    formRequest
      ? "Input.validate()"
      : `validate(http, (r) => ({
    name: r.string().trim().min(2).max(120),
  }))`
  };
${
  o.rejectInput
    ? `
  // For a check validate() cannot make — a wrong password, an address already taken — call
  // rejectInput(http, { name: "Why it failed." }, ${back}) from @app/support/validation.
`
    : ""
}
  http.flash("success", \`Saved \${name}.\`);
  http.redirect(${back}, 303);
}`;
  });

  const unusedCtx =
    o.methods.length === 1 && o.methods[0] === "GET" && !o.params.length && !authorizes;
  const header = unusedCtx ? imports.filter((line) => !line.includes("HttpContext")) : imports;
  const request = formRequest
    ? `

/** What the form must contain. Move it to app/requests/ once another route needs it too. */
class Input extends FormRequest {
  rules(r: RuleBuilder) {
    return {
      name: r.string().trim().min(2).max(120),
    };
  }
}`
    : "";
  return `${header.join("\n")}${request}

${handlers.join("\n\n")}
`;
}
