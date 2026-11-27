/**
 * The server half of a generated resource: the file routes, the form request and the feature
 * test, written the way the starters write their projects example.
 */
import type { _ResourceField, _ResourceModel } from "./fields.ts";
import { _primaryField } from "./fields.ts";
import type { _ResourceNames } from "./names.ts";

/**
 * What the server files are built from.
 *
 * @internal
 */
export interface _ServerContext {
  names: _ResourceNames;
  model: _ResourceModel;
  /** The request class's name, e.g. `TaskRequest`. */
  request: string;
  /** The specifier `from` imports the app module at `to` (no extension) by. */
  appImport: (from: string, to: string) => string;
  /** The specifiers the framework is imported by, as the app imports it. */
  specifiers: { core: string; auth: string; validator: string; testing: string };
  /** The resource is scoped to the signed-in user: the model has an owner and a policy. */
  owned: boolean;
  /** The routes sit behind a sign-in (an `(auth)` group). */
  signedIn: boolean;
}

/** The URL of the list, e.g. `/tasks`. */
function listUrl(c: _ServerContext): string {
  return `/${c.names.segment}`;
}

/** How one field reaches the page: plain JSON, with a date as the string its input holds. */
function pageValue(f: _ResourceField, record: string): string {
  const value = `${record}.${f.property}`;
  if (f.kind === "date" || f.kind === "datetime") {
    const format =
      f.kind === "date"
        ? (v: string) => `${v}.toISOString().slice(0, 10)`
        : (v: string) => `localDateTime(${v})`;
    return f.nullable ? `${value} ? ${format(value)} : null` : format(value);
  }
  return f.nullable ? `${value} ?? null` : value;
}

/** The object literal a route hands the page for one record. */
function pageObject(c: _ServerContext, record: string): string {
  const lines = [
    `id: ${record}.id`,
    ...c.model.fields.map((f) => `${f.property}: ${pageValue(f, record)}`),
  ];
  return `{\n${lines.map((line) => `      ${line},`).join("\n")}\n    }`;
}

/** Whether a route file needs the `localDateTime()` helper. */
function needsLocalDateTime(c: _ServerContext): boolean {
  return c.model.fields.some((f) => f.kind === "datetime");
}

const LOCAL_DATE_TIME = `
/** A moment as a \`datetime-local\` input holds it: the server's local time, to the minute. */
function localDateTime(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return \`\${value.getFullYear()}-\${pad(value.getMonth() + 1)}-\${pad(value.getDate())}T\${pad(value.getHours())}:\${pad(value.getMinutes())}\`;
}
`;

/** The `fill()` payload from the validated data. */
function fillObject(c: _ServerContext): string {
  const lines = c.model.fields.map((f) =>
    // An empty optional text field is stored as null, not as "", as the starters store it.
    f.nullable && (f.kind === "string" || f.kind === "text")
      ? `${f.property}: data.${f.property} || null`
      : `${f.property}: data.${f.property}`,
  );
  return lines.length > 0 ? `{\n${lines.map((l) => `    ${l},`).join("\n")}\n  }` : "{}";
}

/** The message a flash names a record by: its primary field, or what it is. */
function named(c: _ServerContext, record: string, verb: string): string {
  const primary = _primaryField(c.model.fields);
  return primary && !primary.nullable
    ? `\`“\${${record}.${primary.property}}” was ${verb}.\``
    : `"The ${c.names.singular} was ${verb}."`;
}

/** `app/routes/(auth)/tasks/index.ts`: the list (GET) and create (POST). */
export function _indexRoute(c: _ServerContext, file: string): string {
  const { names, model } = c;
  const r = names.record;
  const imports = [
    `import type { HttpContext } from "${c.specifiers.core}";`,
    `import { Inertia } from "@zerotal/inertia";`,
    ...(c.owned ? [`import { Auth } from "${c.specifiers.auth}";`] : []),
    `import { ${model.name} } from "${c.appImport(file, model.file)}";`,
    `import { ${c.request} } from "${c.appImport(file, `app/requests/${c.request}`)}";`,
  ];
  const query = c.owned
    ? `${model.name}.query()\n    .where("${model.owner!.column}", Auth.user().id)`
    : `${model.name}.query()`;
  return `${imports.join("\n")}

const PER_PAGE = 10;
${needsLocalDateTime(c) ? LOCAL_DATE_TIME : ""}
// GET ${listUrl(c)}?page=… — ${c.owned ? `the signed-in user's ${names.plural}` : `every ${names.singular}`}, newest first.
export const GET = async (http: HttpContext) => {
  const page = Math.max(1, Number(new URL(http.request.url).searchParams.get("page")) || 1);
  const result = await ${query}
    .orderBy("id", "desc")
    .paginate(PER_PAGE, page);

  return Inertia.render("${names.segment}/index", {
    title: "${names.title}",
    ${names.records}: result.data.map((${r}) => (${pageObject(c, r).replace(/\n/g, "\n  ")})),
    pagination: {
      page: result.page,
      lastPage: result.lastPage,
      total: result.total,
      from: result.from,
      to: result.to,
    },
  });
};

// POST ${listUrl(c)}
export async function POST(http: HttpContext): Promise<void> {
  // On failure this throws: the visitor is sent back to the form with the errors and
  // what they typed. Below this line every field is valid and typed.
  const data = await ${c.request}.validate();

  const ${r} = new ${model.name}();
  ${r}.fill(${fillObject(c)});${
    c.owned
      ? `\n  // Set in code, never from the form: the owner is whoever is signed in.\n  ${r}.${model.owner!.property} = Auth.user().id;`
      : ""
  }
  await ${r}.save();

  http.flash("success", ${named(c, r, "created")});
  http.redirect("${listUrl(c)}", 303);
}
`;
}

/** `…/tasks/create.ts`: the empty form. */
export function _createRoute(c: _ServerContext): string {
  return `import { Inertia } from "@zerotal/inertia";

// GET ${listUrl(c)}/create
export const GET = async () => {
  return Inertia.render("${c.names.segment}/create", { title: "New ${c.names.singular}" });
};
`;
}

/** `…/tasks/[task]/edit.ts`: the form, filled in. */
export function _editRoute(c: _ServerContext, file: string): string {
  const { names, model } = c;
  const r = names.record;
  const primary = _primaryField(model.fields);
  const title =
    primary && !primary.nullable
      ? `\`Edit \${${r}.${primary.property}}\``
      : `"Edit ${names.singular}"`;
  const imports = [
    `import type { HttpContext } from "${c.specifiers.core}";`,
    `import { Inertia } from "@zerotal/inertia";`,
    ...(c.owned ? [`import { Gate } from "${c.specifiers.auth}";`] : []),
    `import type { ${model.name} } from "${c.appImport(file, model.file)}";`,
  ];
  return `${imports.join("\n")}

// Named to match the other ${names.singular} routes; the generated name would be "${names.segment}.edit.show".
export const meta = { GET: { name: "${names.segment}.edit" } };
${needsLocalDateTime(c) ? LOCAL_DATE_TIME : ""}
// GET ${listUrl(c)}/:${r}/edit — \`:${r}\` arrives as the loaded model (a 404 if there is no
// such ${names.singular})${c.owned ? ", and the policy turns anyone but its owner away with a 403" : ""}.
export const GET = async (http: HttpContext<{ ${r}: ${model.name} }>) => {
  const ${r} = http.params.${r};${c.owned ? `\n  Gate.authorize("update", ${r});` : ""}

  return Inertia.render("${names.segment}/edit", {
    title: ${title},
    ${r}: ${pageObject(c, r).replace(/\n/g, "\n  ")},
  });
};
`;
}

/** `…/tasks/[task]/index.ts`: update (PUT) and delete (DELETE). */
export function _recordRoute(c: _ServerContext, file: string): string {
  const { names, model } = c;
  const r = names.record;
  const imports = [
    `import type { HttpContext } from "${c.specifiers.core}";`,
    ...(c.owned ? [`import { Gate } from "${c.specifiers.auth}";`] : []),
    `import type { ${model.name} } from "${c.appImport(file, model.file)}";`,
    `import { ${c.request} } from "${c.appImport(file, `app/requests/${c.request}`)}";`,
  ];
  return `${imports.join("\n")}

// PUT ${listUrl(c)}/:${r}
export async function PUT(http: HttpContext<{ ${r}: ${model.name} }>): Promise<void> {
  const ${r} = http.params.${r};${c.owned ? `\n  Gate.authorize("update", ${r});` : ""}
  const data = await ${c.request}.validate();

  ${r}.fill(${fillObject(c)});
  await ${r}.save();

  http.flash("success", ${named(c, r, "saved")});
  http.redirect("${listUrl(c)}", 303);
}

// DELETE ${listUrl(c)}/:${r}
export async function DELETE(http: HttpContext<{ ${r}: ${model.name} }>): Promise<void> {
  const ${r} = http.params.${r};${c.owned ? `\n  Gate.authorize("delete", ${r});` : ""}

  await ${r}.delete();

  http.flash("success", ${named(c, r, "deleted")});
  http.redirect("${listUrl(c)}", 303);
}
`;
}

/** The validation rule for one field. */
function rule(f: _ResourceField): string {
  const optional = f.nullable ? ".nullable().optional()" : "";
  switch (f.kind) {
    case "string":
      return f.nullable
        ? "r.string().trim().max(255).optional()"
        : "r.string().trim().min(1).max(255)";
    case "text":
      return f.nullable
        ? "r.string().trim().max(5000).optional()"
        : "r.string().trim().min(1).max(5000)";
    case "number":
      return `r.number()${optional}`;
    case "boolean":
      // An unticked checkbox sends nothing at all, so absent means false.
      return "r.boolean().default(false)";
    case "date":
    case "datetime":
      return `r.date()${optional}`;
    case "enum": {
      const values = f.optionsConst
        ? `[...${f.optionsConst}]`
        : `[${(f.options ?? []).map((o) => JSON.stringify(o)).join(", ")}]`;
      return `r.string().in(${values})`;
    }
  }
}

/** `app/requests/TaskRequest.ts`: the rules create and edit share. */
export function _requestSource(c: _ServerContext, file: string): string {
  const consts = [
    ...new Set(c.model.fields.flatMap((f) => (f.optionsConst ? [f.optionsConst] : []))),
  ];
  const imports = [
    `import { FormRequest } from "${c.specifiers.validator}";`,
    `import type { RuleBuilder } from "${c.specifiers.validator}";`,
    ...(consts.length > 0
      ? [`import { ${consts.sort().join(", ")} } from "${c.appImport(file, c.model.file)}";`]
      : []),
  ];
  const rules = c.model.fields.map((f) => `      ${f.property}: ${rule(f)},`).join("\n");
  return `${imports.join("\n")}

/**
 * What a ${c.names.singular} form must contain — shared by create and edit, so the two cannot
 * disagree. \`await ${c.request}.validate()\` returns the typed fields, or sends the visitor back
 * to the form with the errors and what they typed.
 */
export class ${c.request} extends FormRequest {
  rules(r: RuleBuilder) {
    return {
${rules}
    };
  }
}
`;
}

/** A value the test's form sends for a field, as a browser sends it: a string. */
function formValue(f: _ResourceField, changed = false): string {
  switch (f.kind) {
    case "string":
      return changed ? "Changed" : `Example ${f.label.toLowerCase()}`;
    case "text":
      return `Some ${f.label.toLowerCase()}.`;
    case "number":
      return changed ? "7" : "3";
    case "boolean":
      return "true";
    case "date":
      return "2026-01-15";
    case "datetime":
      return "2026-01-15T09:30";
    case "enum":
      return f.options?.[f.options.length > 1 ? 1 : 0] ?? "";
  }
}

/** The same value as the model holds it, for a record the test saves directly. */
function modelValue(f: _ResourceField): string {
  switch (f.kind) {
    case "number":
      return "3";
    case "boolean":
      return "false";
    case "date":
      return `new Date("2026-01-15")`;
    case "datetime":
      return `new Date("2026-01-15T09:30:00")`;
    case "enum":
      return JSON.stringify(f.options?.[0] ?? "");
    default:
      return JSON.stringify(formValue(f));
  }
}

/** The props one record reaches a page with, for the page-render tests. */
function pageFixture(f: _ResourceField): string {
  switch (f.kind) {
    case "number":
      return "3";
    case "boolean":
      return "false";
    case "enum":
      return JSON.stringify(f.options?.[0] ?? "");
    default:
      return JSON.stringify(formValue(f));
  }
}

/**
 * What the feature test needs to render the pages, which differs by kit: React pages render
 * through `@zerotal/inertia/testing`, Vue ones through the starter's `tests/render.ts` once the
 * app has booted (the `.vue` loader is registered then).
 *
 * @internal
 */
export interface _TestPages {
  framework: "react" | "vue";
  /** Each page's import from the test, by page name (`tasks/index`). */
  imports: Record<"index" | "create" | "edit", string>;
  /** The import `renderPage` comes from (Vue: the starter's `./render`). */
  render: string;
  /** The routes module and the generated routes the layouts' `route()` reads. */
  routes: { define: string; generated: string } | undefined;
}

/** `tests/tasks.test.ts`: every action, end to end, and the pages built once. */
export function _testSource(c: _ServerContext, pages: _TestPages | undefined): string {
  const { names, model } = c;
  const r = names.record;
  const M = model.name;
  const url = listUrl(c);
  const primary = _primaryField(model.fields);
  const required = model.fields.filter((f) => !f.nullable && f.kind !== "boolean");
  const valid = `{ ${model.fields.map((f) => `${f.property}: ${JSON.stringify(formValue(f))}`).join(", ")} }`;
  const saved = model.fields.map((f) => `${f.property}: ${modelValue(f)}`).join(", ");
  const tests: string[] = [];

  if (c.signedIn) {
    tests.push(`  test("keeps ${names.plural} behind a sign-in", async () => {
    (await app.get("${url}")).assertRedirect("/login");
  });`);
  }

  tests.push(`  test("lists ${c.owned ? `only the signed-in user’s ${names.plural}` : names.plural}", async () => {
    const user = await UserFactory.create();
    await create${M}(user);
    await create${M}(${c.owned ? "await UserFactory.create()" : "user"});

    const page = (await app.actingAs(user).get("${url}"))
      .assertOk()
      .assertInertia("${names.segment}/index")
      .inertia();

    expect(page?.props["${names.records}"]).toHaveLength(${c.owned ? 1 : 2});
  });`);

  tests.push(`  test("creates a ${names.singular}${c.owned ? " owned by the signed-in user" : ""}", async () => {
    const user = await UserFactory.create();

    (await app.actingAs(user).get("${url}/create")).assertOk().assertInertia("${names.segment}/create");
    const res = await app.actingAs(user).postForm("${url}", valid);

    res.assertRedirect("${url}");
    res.assertSessionHas("success");
    await assertDatabaseHas("${model.table}", { ${[
      ...(primary ? [`${primary.column}: ${JSON.stringify(formValue(primary))}`] : []),
      ...(c.owned ? [`${model.owner!.column}: user.id`] : []),
    ].join(", ")} });
  });`);

  if (required.length > 0) {
    tests.push(`  test("rejects a ${names.singular} with nothing filled in", async () => {
    const user = await UserFactory.create();

    const res = await app
      .actingAs(user)
      .postForm("${url}", {}, { Referer: \`\${app.baseUrl}${url}/create\` });

    res.assertRedirect("${url}/create");
    res.assertInvalid([${required.map((f) => JSON.stringify(f.property)).join(", ")}]);
    await assertDatabaseMissing("${model.table}", {});
  });`);
  }

  if (c.owned) {
    tests.push(`  test("ignores an owner sent with the form", async () => {
    const user = await UserFactory.create();
    const other = await UserFactory.create();

    await app.actingAs(user).postForm("${url}", { ...valid, ${model.owner!.column}: other.id, ${model.owner!.property}: other.id });

    await assertDatabaseHas("${model.table}", { ${model.owner!.column}: user.id });
    await assertDatabaseMissing("${model.table}", { ${model.owner!.column}: other.id });
  });`);
  }

  const changedField = primary ?? model.fields.find((f) => f.kind === "number");
  tests.push(`  test("edits a ${names.singular}", async () => {
    const user = await UserFactory.create();
    const ${r} = await create${M}(user);

    (await app.actingAs(user).get(\`${url}/\${${r}.id}/edit\`))
      .assertOk()
      .assertInertia("${names.segment}/edit");
    const res = await app
      .actingAs(user)
      .putForm(\`${url}/\${${r}.id}\`, { ...valid${changedField ? `, ${changedField.property}: ${JSON.stringify(formValue(changedField, true))}` : ""} });

    res.assertRedirect("${url}");${
      changedField
        ? `\n    expect((await ${M}.find(${r}.id))?.${changedField.property}).toBe(${changedField.kind === "number" ? "7" : '"Changed"'});`
        : ""
    }
  });`);

  tests.push(`  test("deletes a ${names.singular}", async () => {
    const user = await UserFactory.create();
    const ${r} = await create${M}(user);

    (await app.actingAs(user).delete(\`${url}/\${${r}.id}\`)).assertRedirect("${url}");

    expect(await ${M}.find(${r}.id)).toBeNull();
  });`);

  tests.push(`  test("answers 404 for a ${names.singular} that does not exist", async () => {
    const user = await UserFactory.create();

    (await app.actingAs(user).get("${url}/999999/edit")).assertNotFound();
  });`);

  if (c.owned) {
    tests.push(`  test("forbids another user from seeing, changing or deleting a ${names.singular}", async () => {
    const owner = await UserFactory.create();
    const stranger = await UserFactory.create();
    const ${r} = await create${M}(owner);

    (await app.actingAs(stranger).get(\`${url}/\${${r}.id}/edit\`)).assertForbidden();
    (await app.actingAs(stranger).putForm(\`${url}/\${${r}.id}\`, valid)).assertForbidden();
    (await app.actingAs(stranger).delete(\`${url}/\${${r}.id}\`)).assertForbidden();

    expect(await ${M}.find(${r}.id)).not.toBeNull();
  });`);
  }

  const fixture = `{ id: 1, ${model.fields.map((f) => `${f.property}: ${pageFixture(f)}`).join(", ")} }`;
  const vue = pages?.framework === "vue";
  const pageRef = (key: "index" | "create" | "edit") => PAGE_COMPONENT[key];
  const pageTests = pages
    ? `

/**
 * Each page built once, to prove it can be: the tests above prove the server named a page and
 * handed it props, and this proves the page renders from them. It is not a DOM — nothing clicks.
 */
describe("${names.plural} pages render", () => {
  const ${r} = ${fixture};
  const shared = {
    app: { name: "Acme" },
    features: { passkeys: false },
    auth: { user: { id: 1, name: "Ada", email: "ada@example.com", emailVerifiedAt: null, twoFactorConfirmedAt: null } },
    flash: { success: null, error: null, warning: null, info: null },
    errors: {},
    old: {},
  };
  const empty = { page: 1, lastPage: 1, total: 0, from: null, to: null };

  test("the empty list", async () => {
    await renderPage(${pageRef("index")}, { title: "${names.title}", ${names.records}: [], pagination: empty }, { shared, url: "${url}" });
  });
  test("a list with one ${names.singular}", async () => {
    await renderPage(
      ${pageRef("index")},
      { title: "${names.title}", ${names.records}: [${r}], pagination: { ...empty, total: 1, from: 1, to: 1 } },
      { shared, url: "${url}" },
    );
  });
  test("the create form", async () => {
    await renderPage(${pageRef("create")}, { title: "New ${names.singular}" }, { shared, url: "${url}/create" });
  });
  test("the edit form", async () => {
    await renderPage(${pageRef("edit")}, { title: "Edit", ${r} }, { shared, url: "${url}/1/edit" });
  });
});
`
    : "";

  const testingImports = [
    "assertDatabaseHas",
    ...(required.length > 0 || c.owned ? ["assertDatabaseMissing"] : []),
    "refreshDatabase",
    "type TestApp",
  ];
  const imports = [
    `import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";`,
    `import { ${testingImports.join(", ")} } from "${c.specifiers.testing}";`,
    ...(pages?.routes ? [`import { defineRoutes } from "${pages.routes.define}";`] : []),
    ...(pages && !vue ? [`import { renderPage } from "${pages.render}";`] : []),
    `import { ${M} } from "../${model.file}";`,
    ...(pages && !vue
      ? (["index", "create", "edit"] as const).map(
          (key) => `import ${PAGE_COMPONENT[key]} from "${pages.imports[key]}";`,
        )
      : []),
    `import { UserFactory } from "../database/factories/UserFactory";`,
    ...(pages && vue ? [`import type { Component } from "vue";`] : []),
    ...(pages?.routes ? [`import { ROUTES } from "${pages.routes.generated}";`] : []),
    ...(pages && vue ? [`import { renderPage } from "${pages.render}";`] : []),
    `import { bootApp } from "./support";`,
  ];

  return `${imports.join("\n")}

/**
 * ${names.title}, end to end: every action a user takes on a ${names.singular}${
   c.owned ? `, and the policy that\n * keeps one user's ${names.plural} from another` : ""
 }. Written by \`make:resource\`; extend it as the
 * feature grows.
 */
let app: TestApp;${vue && pages ? `\n${(["index", "create", "edit"] as const).map((key) => `let ${PAGE_COMPONENT[key]}: Component;`).join("\n")}` : ""}

beforeAll(async () => {
  app = await bootApp();${
    vue && pages
      ? `\n  // \`.vue\` files can be imported once the app has booted: InertiaProvider registers the\n  // compiler as a loader then.\n${(
          ["index", "create", "edit"] as const
        )
          .map(
            (key) => `  ${PAGE_COMPONENT[key]} = (await import("${pages.imports[key]}")).default;`,
          )
          .join("\n")}`
      : ""
  }
});
afterAll(() => app.close());
beforeEach(() => app.actingAsGuest());
${pages?.routes ? "\n// The layouts call `route()`, which `defineRoutes` installs, as the browser's app.tsx does.\ndefineRoutes(ROUTES);\n" : ""}
/** What a filled-in form sends. */
const valid = ${valid};

/** A ${names.singular}${c.owned ? " owned by `user`" : ""}, saved. */
async function create${M}(${c.owned ? "user: { id: number }" : "_user: { id: number }"}): Promise<${M}> {
  const ${r} = new ${M}();
  ${r}.fill({ ${saved} });${c.owned ? `\n  ${r}.${model.owner!.property} = user.id;` : ""}
  await ${r}.save();
  return ${r};
}

describe("${names.plural}", () => {
  refreshDatabase();

${tests.join("\n\n")}
});${pageTests}
`;
}

/** The names the React test imports each page under. */
const PAGE_COMPONENT = { index: "IndexPage", create: "CreatePage", edit: "EditPage" } as const;
