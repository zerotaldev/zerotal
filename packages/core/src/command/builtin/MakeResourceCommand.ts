/**
 * The `make:resource` command, which scaffolds an API resource transformer — or, given
 * `--model` in an Inertia app, a whole screen over that model.
 */
import { Command } from "../Command.ts";
import type { FlagDef } from "../Command.ts";
import { _writeAppSource } from "../appSource.ts";
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
export class MakeResourceCommand extends Command {
  static commandName = "make:resource";
  static description =
    "Create an API resource transformer, or with --model an Inertia screen over a model";
  static needsApp = false;

  static args = [
    { name: "name", required: true, description: "Resource name (e.g. UserResource, or Task)" },
  ];

  static flags: FlagDef[] = [
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

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const screenOf = ((this.flags["model"] as string | undefined) ?? "").trim();
    if (screenOf) {
      await this.screen(name, screenOf);
      return;
    }
    const path = `app/resources/${name}.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    await _writeAppSource(path, _stub(name));
    this.info(`Created: ${path}`);

    const model = name.replace(/Resource$/, "");
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
      this.error(
        "make:resource --model writes an Inertia screen, and this app has no @zerotal/inertia. " +
          `In a Flow app, run \`bun zt make:flow ${name} --crud --model ${model}\`; ` +
          "without --model, make:resource writes an API resource transformer.",
      );
      process.exitCode = 1;
      return;
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
    if (!ok) process.exitCode = 1;
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
export function _stub(name: string): string {
  const model = name.replace(/Resource$/, "");
  // From the singular, so `Post` and `Posts` are both `/api/posts`, and `BlogPost` is
  // `/api/blog-posts`. The old conversion read a capture group as an index and produced `/api/-post`.
  const route = pluralize(singularize(snakeCase(model))).replace(/_/g, "-");
  return `import { Resource } from 'zerotal/http';
import type { ${model} } from '../models/${model}';

export class ${name} extends Resource<${model}> {
  toArray(): Record<string, unknown> {
    return {
      id:         this.resource.id,
      // Add fields here — omit sensitive ones like 'password'
      created_at: this.resource.createdAt,
    };
  }
}

// ── Usage in controllers ────────────────────────────────────────────────────

// Single model:
//   ctx.json(new ${name}(model).toJson());            // { data: { ... } }
//   ctx.response = new ${name}(model).toResponse(201);

// Paginated list (ResourceCollection adds { data, meta, links } automatically):
//   import { ResourceCollection } from 'zerotal/http';
//   const paginated = await ${model}.query().paginate(15, page);
//   ctx.json(ResourceCollection.of(${name}, paginated, '/api/${route}'));
`;
}
