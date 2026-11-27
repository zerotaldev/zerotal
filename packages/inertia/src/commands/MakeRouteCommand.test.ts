import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MakeRouteCommand, _pageName, _routePath, _urlOf } from "./MakeRouteCommand.ts";

class Collector {
  out = "";
  write(s: string) {
    this.out += s;
  }
  writeLine(s: string) {
    this.out += s + "\n";
  }
  writeError(s: string) {
    this.out += s + "\n";
  }
}

const cwd = process.cwd();
const dirs: string[] = [];
afterEach(async () => {
  process.chdir(cwd);
  process.exitCode = 0;
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

/** An app laid out like the React starter, with a Project model and its policy. */
async function starter(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "makeroute-"));
  dirs.push(root);
  await Bun.write(join(root, "resources/js/Layouts/AppLayout.tsx"), "");
  await Bun.write(join(root, "resources/js/pages/home.tsx"), "export default function Home() {}\n");
  await Bun.write(
    join(root, "app/models/Project.ts"),
    `import { Model, column } from "zerotal/orm";\nexport class Project extends Model {\n  @column({ type: "string" }) name!: string;\n}\n`,
  );
  await Bun.write(join(root, "app/policies/ProjectPolicy.ts"), "");
  await Bun.write(join(root, "app/support/validation.ts"), "");
  await Bun.write(
    join(root, "tsconfig.json"),
    `{ "compilerOptions": { "paths": { "@app/*": ["./app/*"] } } }\n`,
  );
  await Bun.write(join(root, "package.json"), `{ "dependencies": { "zerotal": "*" } }\n`);
  process.chdir(root);
  return root;
}

async function run(path: string, flags: Record<string, unknown> = {}): Promise<string> {
  const c = new MakeRouteCommand();
  const col = new Collector();
  (c as unknown as { _writer: unknown })._writer = col;
  (c as unknown as { args: Record<string, string> }).args = { path };
  (c as unknown as { flags: Record<string, unknown> }).flags = {
    methods: "GET,POST",
    page: "",
    framework: "react",
    ...flags,
  };
  await c.run();
  return col.out;
}

describe("make:route paths", () => {
  it("reads the path under app/routes/ however it is typed", () => {
    expect(_routePath("reports")).toBe("reports");
    expect(_routePath("app/routes/reports.ts")).toBe("reports");
    expect(_routePath("/(auth)/reports/")).toBe("(auth)/reports");
  });

  it("serves the URL file routing serves", () => {
    expect(_urlOf("(auth)/(verified)/projects/index")).toBe("/projects");
    expect(_urlOf("(auth)/projects/[project]/edit")).toBe("/projects/:project/edit");
    expect(_urlOf("about")).toBe("/about");
  });

  it("renders the page the starters would name", () => {
    expect(_pageName("(auth)/(verified)/projects/index")).toBe("projects/index");
    expect(_pageName("(auth)/projects/[project]/edit")).toBe("projects/edit");
    expect(_pageName("dashboard")).toBe("dashboard");
  });
});

describe("make:route", () => {
  it("writes GET and POST in the starters' style, and the page GET renders", async () => {
    const root = await starter();
    const out = await run("reports");

    const route = readFileSync(join(root, "app/routes/reports.ts"), "utf8");
    expect(route).toContain('import type { HttpContext } from "zerotal";');
    expect(route).toContain('import { validate } from "zerotal/validator";');
    expect(route).toContain('return Inertia.render("reports", {');
    expect(route).toContain("name: r.string().trim().min(2).max(120),");
    expect(route).toContain('http.redirect("/reports", 303);');
    expect(route).toContain("rejectInput(");
    expect(readFileSync(join(root, "resources/js/pages/reports.tsx"), "utf8")).toContain(
      "<AppLayout>{page}</AppLayout>",
    );
    expect(out).toContain("Serves /reports (GET, POST).");
  });

  it("loads a [param] named after a model, and authorizes against its policy", async () => {
    const root = await starter();
    await run("(auth)/projects/[project]/archive", { methods: "GET,POST" });

    const route = readFileSync(
      join(root, "app/routes/(auth)/projects/[project]/archive.ts"),
      "utf8",
    );
    expect(route).toContain('import type { Project } from "@app/models/Project";');
    expect(route).toContain(
      "export const GET = async (http: HttpContext<{ project: Project }>) => {",
    );
    expect(route).toContain('Gate.authorize("view", http.params.project);');
    expect(route).toContain('Gate.authorize("update", http.params.project);');
    // A context of loaded models is not the plain one validate() takes: a FormRequest reads it.
    expect(route).toContain("class Input extends FormRequest {");
    expect(route).toContain("await Input.validate();");
    expect(route).toContain("http.redirect(`/projects/${http.params.project.id}/archive`, 303);");
    expect(route).toContain('Inertia.render("projects/archive"');
  });

  it("writes only the handlers --methods names", async () => {
    const root = await starter();
    await run("(auth)/billing", { methods: "GET" });

    const route = readFileSync(join(root, "app/routes/(auth)/billing.ts"), "utf8");
    expect(route).not.toContain("POST");
    expect(route).not.toContain("validate");
    expect(route).not.toContain("HttpContext");
  });

  it("refuses a verb file routing does not serve, and a file already there", async () => {
    await starter();
    expect(await run("reports", { methods: "GET,FETCH" })).toContain("not FETCH");
    expect(process.exitCode).toBe(1);

    process.exitCode = 0;
    await run("reports");
    expect(await run("reports")).toContain("File already exists: app/routes/reports.ts");
  });
});
