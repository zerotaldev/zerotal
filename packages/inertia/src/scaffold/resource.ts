/**
 * `make:resource <Name> --model <Model>` in an Inertia app: a whole screen over one model —
 * file routes, a form request, a policy, the React or Vue pages, the shared form and a feature
 * test — in the shape of the starters' projects example.
 */
import { config } from "@zerotal/core";
import {
  _frameworkImport,
  _relativeImport,
  _writeAppSource,
  _policyStub,
} from "@zerotal/core/commands";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generatePageRegistry } from "../PageRegistry.ts";
import { DEFAULT_PAGES_DIR } from "../config.ts";
import { _componentName } from "../commands/MakePageCommand.ts";
import {
  _libSource,
  _reactForm,
  _reactPages,
  _requiredComponents,
  _vueForm,
  _vuePages,
} from "./client.ts";
import { _readResourceModel } from "./fields.ts";
import { _resourceNames } from "./names.ts";
import {
  _createRoute,
  _editRoute,
  _indexRoute,
  _recordRoute,
  _requestSource,
  _testSource,
  type _ServerContext,
  type _TestPages,
} from "./server.ts";

/**
 * Where a generator reports to: the command that called it.
 *
 * @internal
 */
export interface _ScaffoldOutput {
  info(message: string): void;
  warn(message: string): void;
  dim(message: string): void;
  error(message: string): void;
}

/**
 * What `make:resource` was asked for.
 *
 * @internal
 */
export interface _MakeResourceOptions {
  /** The resource's name, e.g. `Task`: its URL is the plural, `/tasks`. */
  name: string;
  /** The model it lists and edits, e.g. `Task`. */
  model: string;
  /** `react` or `vue`; detected from the installed adapter when absent. */
  framework?: "react" | "vue" | undefined;
  /** Run `zt route:types` afterwards (default true). Tests turn it off. */
  routeTypes?: boolean | undefined;
  cwd?: string | undefined;
}

/** The frontend framework of the app at `cwd`, from the Inertia adapter it installs. */
function detectFramework(cwd: string): "react" | "vue" {
  try {
    Bun.resolveSync("@inertiajs/vue3", cwd);
    return "vue";
  } catch {
    return "react";
  }
}

/**
 * Where the routes go: inside the starters' signed-in groups when the app has them, since a
 * screen over one user's records only makes sense signed in. `(verified)` is where the starters
 * keep the projects example.
 */
function routesDir(cwd: string): { dir: string; signedIn: boolean } {
  for (const dir of ["app/routes/(auth)/(verified)", "app/routes/(auth)"]) {
    if (existsSync(join(cwd, dir))) return { dir, signedIn: true };
  }
  return { dir: "app/routes", signedIn: false };
}

/**
 * Writes the resource. Returns false, having written nothing, when the app cannot take it: no
 * such model, a file already there, or pages the starter components are missing for.
 *
 * @internal
 */
export async function _makeResource(
  out: _ScaffoldOutput,
  options: _MakeResourceOptions,
): Promise<boolean> {
  const cwd = options.cwd ?? process.cwd();
  const at = (file: string) => join(cwd, file);

  // Every file name and identifier the resource writes comes from these two, so a `/` or `.`
  // would put files outside their folders and an import would not parse.
  const bad = [options.name, options.model].find((n) => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(n));
  if (bad !== undefined) {
    out.error(
      `"${bad}" is not a name make:resource can use: start with a letter, then letters, digits, - or _.`,
    );
    return false;
  }

  const read = _readResourceModel(options.model, cwd);
  if (!read) {
    out.error(
      `No model exports ${options.model} in app/models/. Run \`bun zt make:model ${options.model} --migration\` first.`,
    );
    return false;
  }
  const { model, skipped } = read;
  if (model.name === "User") {
    // Its record would be `user`, the name the routes and the test give the signed-in user, and
    // a screen over every account is an admin panel, not a resource one user owns.
    out.error(
      "make:resource does not write a screen over User: every name in it would shadow the " +
        "signed-in user. Write that screen with `bun zt make:route`, or use @zerotal/admin.",
    );
    return false;
  }
  const names = _resourceNames(options.name, model.name);
  const framework = options.framework ?? detectFramework(cwd);
  const ext = framework === "vue" ? "vue" : "tsx";

  const pagesDir = config
    .safe("inertia.pagesDir", DEFAULT_PAGES_DIR)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const jsRoot = dirname(pagesDir);
  const missing = _requiredComponents(framework).filter(
    (file) => !existsSync(at(`${jsRoot}/${file}`)),
  );
  if (missing.length > 0) {
    out.error(
      `make:resource builds its pages from the starter's components, and this app is missing ` +
        `${missing.map((file) => `${jsRoot}/${file}`).join(", ")}. Write the pages with \`bun zt make:page\` instead.`,
    );
    return false;
  }

  const { dir, signedIn } = routesDir(cwd);
  const base = `${dir}/${names.segment}`;
  const param = `[${names.record}]`;
  const request = `${model.name}Request`;
  const form = `${names.component}Form`;
  const lib = names.segment;
  const policy = `app/policies/${model.name}Policy.ts`;
  const owned = model.owner !== undefined;

  const pages = {
    index: `${pagesDir}/${names.segment}/index.${ext}`,
    create: `${pagesDir}/${names.segment}/create.${ext}`,
    edit: `${pagesDir}/${names.segment}/edit.${ext}`,
  };
  const files = {
    indexRoute: `${base}/index.ts`,
    createRoute: `${base}/create.ts`,
    editRoute: `${base}/${param}/edit.ts`,
    recordRoute: `${base}/${param}/index.ts`,
    lib: `${jsRoot}/lib/${lib}.ts`,
    form: `${jsRoot}/Components/${form}.${ext}`,
    ...pages,
  };
  const testFile = `tests/${names.segment}.test.ts`;
  const taken = [...Object.values(files), testFile].filter((file) => existsSync(at(file)));
  if (taken.length > 0) {
    out.error(`Not written, because these already exist: ${taken.join(", ")}`);
    return false;
  }

  const tsconfig = (() => {
    try {
      return readFileSync(at("tsconfig.json"), "utf8");
    } catch {
      return "";
    }
  })();
  const aliased = tsconfig.includes('"@app/*"');
  const appImport = (from: string, to: string) =>
    aliased && to.startsWith("app/") ? `@${to}` : _relativeImport(from, to);

  const server: _ServerContext = {
    names,
    model,
    request,
    appImport,
    specifiers: {
      core: _frameworkImport("@zerotal/core", cwd),
      auth: _frameworkImport("@zerotal/auth", cwd),
      validator: _frameworkImport("@zerotal/validator", cwd),
      testing: _frameworkImport("@zerotal/testing", cwd),
    },
    owned,
    signedIn,
  };
  const client = { names, model, framework, form, lib };
  const components = {
    index: _componentName(`${names.segment}/index`),
    create: _componentName(`${names.segment}/create`),
    edit: _componentName(`${names.segment}/edit`),
  };
  const pageSources =
    framework === "vue" ? _vuePages(client, components) : _reactPages(client, components);

  const written: string[] = [];
  const write = async (file: string, source: string) => {
    await _writeAppSource(at(file), source, cwd);
    written.push(file);
  };

  if (existsSync(at(`app/requests/${request}.ts`))) {
    out.warn(`  app/requests/${request}.ts exists, so the routes use it as it is.`);
  } else {
    await write(`app/requests/${request}.ts`, _requestSource(server, `app/requests/${request}.ts`));
  }
  if (owned && !existsSync(at(policy))) {
    const user = existsSync(at("app/models/User.ts"));
    await write(
      policy,
      _policyStub(`${model.name}Policy`, model.name, {
        auth: server.specifiers.auth,
        modelImport: `${_relativeImport(policy, model.file)}.ts`,
        userImport: user ? `${_relativeImport(policy, "app/models/User")}.ts` : false,
        owner: model.owner!.property,
      }),
    );
  }
  await write(files.indexRoute, _indexRoute(server, files.indexRoute));
  await write(files.createRoute, _createRoute(server));
  await write(files.editRoute, _editRoute(server, files.editRoute));
  await write(files.recordRoute, _recordRoute(server, files.recordRoute));
  await write(files.lib, _libSource(client));
  await write(files.form, framework === "vue" ? _vueForm(client) : _reactForm(client));
  await write(pages.index, pageSources.index);
  await write(pages.create, pageSources.create);
  await write(pages.edit, pageSources.edit);

  const support = (() => {
    try {
      return readFileSync(at("tests/support.ts"), "utf8");
    } catch {
      return "";
    }
  })();
  if (!/export\s+async\s+function\s+bootApp\b/.test(support)) {
    out.warn(
      `  No bootApp() in tests/support.ts, so no test was written. Run \`bun zt make:test ${names.segment}\`.`,
    );
  } else if (!existsSync(at("database/factories/UserFactory.ts"))) {
    out.warn(
      "  No database/factories/UserFactory.ts to sign a user in with, so no test was written.",
    );
  } else {
    // React pages are imported without their extension, as the starters import them.
    const pageImport = (file: string) =>
      _relativeImport(testFile, framework === "vue" ? file : file.replace(/\.tsx$/, ""));
    const routesGenerated = existsSync(at("types/routes.generated.ts"));
    const testPages: _TestPages | undefined =
      framework === "vue" && !existsSync(at("tests/render.ts"))
        ? undefined
        : {
            framework,
            imports: {
              index: pageImport(pages.index),
              create: pageImport(pages.create),
              edit: pageImport(pages.edit),
            },
            render: framework === "vue" ? "./render" : "@zerotal/inertia/testing",
            routes: routesGenerated
              ? {
                  define: server.specifiers.core === "zerotal" ? "zerotal/routes" : "@zerotal/core",
                  generated: _relativeImport(testFile, "types/routes.generated"),
                }
              : undefined,
          };
    await write(testFile, _testSource(server, testPages));
  }

  for (const file of written) out.info(`Created: ${file}`);
  if (skipped.length > 0) {
    out.warn(`  Left out of the form, as no input edits them: ${skipped.join(", ")}.`);
  }
  if (!owned) {
    out.warn(
      `  ${model.name} has no userId column, so every signed-in user sees and changes every ` +
        `${names.singular}. Add an owner column and generate again to scope it to its owner.`,
    );
  }

  await generatePageRegistry(cwd, pagesDir);
  out.dim("  Page registry updated.");

  if (options.routeTypes !== false) {
    if (await _refreshRouteTypes(cwd)) out.dim("  Route types updated.");
    else out.warn("  Run `bun zt route:types`, so route() knows the new routes.");
  }
  out.info(`Open ${"/" + names.segment} — and run its test with: bun zt test ${testFile}`);
  return true;
}

/**
 * Regenerate `types/routes.generated.ts` by running `zt route:types` in the app, which boots it
 * and reads the routes it actually registers. The pages call `route()` with the new names, and
 * without this the app would not typecheck until someone ran it by hand.
 *
 * @internal
 */
export async function _refreshRouteTypes(cwd: string): Promise<boolean> {
  const entry = ["zt.ts", "zerotal.ts"].find((file) => existsSync(join(cwd, file)));
  if (!entry) return false;
  const proc = Bun.spawn([process.execPath, entry, "route:types"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return (await proc.exited) === 0;
}
