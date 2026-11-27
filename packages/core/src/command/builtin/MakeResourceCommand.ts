/**
 * The `make:resource` command, which scaffolds an API resource transformer — or, given
 * `--model` in an Inertia app, a whole screen over that model.
 */
import type { FlagDef } from "../Command.ts";
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";
import { pluralize, singularize, snakeCase } from "../../support/str.ts";

/**
 * The module a view package lends `make:resource --model` from, looked up in the app (as
 * `zt compile` looks up its contributors), because this command runs without booting the app
 * and so never sees a command a package registers at boot.
 */
const RESOURCE_GENERATORS = ["@zerotal/inertia/scaffold"] as const;

/** What a resource generator is handed. */
interface ResourceGenerator {
  _makeResource(
    out: {
      info(message: string): void;
      warn(message: string): void;
      dim(message: string): void;
      error(message: string): void;
    },
    options: { name: string; model: string; framework?: "react" | "vue" | undefined },
  ): Promise<boolean>;
}

/**
 * `bun zt make:resource <name>` — scaffolds a new API resource transformer
 * class under `app/resources/`.
 *
 * With `--model`, in an Inertia app, it writes a screen over that model instead: the file
 * routes for list, create, edit, update and delete (scoped to the signed-in user when the model
 * has a `userId`), a form request, a policy, the React or Vue pages and their shared form, and
 * a feature test.
 *
 * @category Scaffolding (make:*)
 */
export class MakeResourceCommand extends GeneratorCommand {
  static override commandName = "make:resource";
  static override description =
    "Create an API resource transformer, or with --model an Inertia screen over a model";
  static override args = [
    { name: "name", required: true, description: "Resource name (e.g. UserResource, or Task)" },
  ];

  static override flags: FlagDef[] = [
    {
      name: "model",
      short: "m",
      type: "string" as const,
      description:
        "Write an Inertia screen (routes, pages, form, test) listing and editing this model",
      default: "",
    },
    {
      name: "framework",
      type: "string" as const,
      description: "With --model, force the pages' framework: 'react' or 'vue' (auto-detected)",
      default: "",
    },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const screenOf = ((this.flags["model"] as string | undefined) ?? "").trim();
    if (screenOf) {
      // The screen is written by the view package, file by file; it does not yet take the
      // generator flags, and dropping them would write what a --dry-run asked not to.
      if (this.dryRun || this.force) {
        return this.refuse(
          `make:resource --model does not take ${this.dryRun ? "--dry-run" : "--force"} yet; ` +
            "without --model, make:resource writes an API resource transformer and takes both.",
        );
      }
      await this.screen(name, screenOf);
      return;
    }
    const path = `app/resources/${name}.ts`;
    if (!(await this.writeFile(path, _stub(name, _frameworkImport("@zerotal/core"))))) return;

    const model = name.replace(/Resource$/, "");
    this.next(
      `Return it from a controller: ctx.json(new ${name}(${model.charAt(0).toLowerCase() + model.slice(1)}).toJson());`,
    );
    if (!(await Bun.file(`app/models/${model}.ts`).exists())) {
      this.warn(
        `  It is typed against app/models/${model}.ts, which does not exist yet: ` +
          `run \`bun zt make:model ${model} --migration\`, or change the import.`,
      );
    }
  }

  /** `--model`: hand the screen to the view package the app installs. */
  private async screen(name: string, model: string): Promise<void> {
    const generator = await _resourceGenerator(process.cwd());
    if (!generator) {
      return this.refuse(
        "make:resource --model writes an Inertia screen, and this app has no @zerotal/inertia. " +
          `In a Flow app, run \`bun zt make:flow ${name} --crud --model ${model}\`; ` +
          "without --model, make:resource writes an API resource transformer.",
      );
    }
    const forced = ((this.flags["framework"] as string | undefined) ?? "").toLowerCase();
    const ok = await generator._makeResource(
      {
        info: (m) => this.info(m),
        warn: (m) => this.warn(m),
        dim: (m) => this.dim(m),
        error: (m) => this.error(m),
      },
      {
        name,
        model,
        ...(forced === "react" || forced === "vue" ? { framework: forced } : {}),
      },
    );
    if (!ok) {
      this.refused = true;
      process.exitCode = 1;
    }
  }
}

/**
 * The resource generator the app installs, if any: the first of {@link RESOURCE_GENERATORS}
 * that resolves from `cwd`.
 */
async function _resourceGenerator(cwd: string): Promise<ResourceGenerator | undefined> {
  for (const specifier of RESOURCE_GENERATORS) {
    let path: string;
    try {
      path = Bun.resolveSync(specifier, cwd);
    } catch {
      continue;
    }
    const module = (await import(path)) as Partial<ResourceGenerator>;
    if (typeof module._makeResource === "function") return module as ResourceGenerator;
  }
  return undefined;
}

/** @internal Exported for tests. */
export function _stub(name: string, core = "zerotal"): string {
  const model = name.replace(/Resource$/, "");
  // From the singular, so `Post` and `Posts` are both `/api/posts`, and `BlogPost` is
  // `/api/blog-posts`. The old conversion read a capture group as an index and produced `/api/-post`.
  const route = pluralize(singularize(snakeCase(model))).replace(/_/g, "-");
  return `import { Resource } from "${core}/http";
import type { ${model} } from "../models/${model}";

export class ${name} extends Resource<${model}> {
  toArray(): Record<string, unknown> {
    return {
      id: this.resource.id,
      // Add fields here — omit sensitive ones like "password"
      created_at: this.resource.createdAt,
    };
  }
}

// ── Usage in controllers ────────────────────────────────────────────────────

// Single model:
//   ctx.json(new ${name}(model).toJson());            // { data: { ... } }
//   ctx.response = new ${name}(model).toResponse(201);

// Paginated list (ResourceCollection adds { data, meta, links } automatically):
//   import { ResourceCollection } from "${core}/http";
//   const paginated = await ${model}.query().paginate(15, page);
//   ctx.json(ResourceCollection.of(${name}, paginated, "/api/${route}"));
`;
}
