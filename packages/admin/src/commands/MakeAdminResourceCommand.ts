import { Command } from "@zerotal/core";
import type { FlagDef } from "@zerotal/core";
import { pluralize } from "@zerotal/core/helpers";

/**
 * Scaffolds an admin resource (`bun zt make:admin-resource`).
 *
 * Named `make:admin-resource` rather than `make:resource` because that name
 * already belongs to the API transformer generator — two different things that
 * would otherwise collide.
 *
 * @example
 * ```bash
 * bun zt make:admin-resource Product
 * bun zt make:admin-resource Comment --parent=Post --foreign-key=post_id
 * bun zt make:admin-resource Setting --singular
 * ```
 *
 * @category Scaffolding (make:*)
 */
export class MakeAdminResourceCommand extends Command {
  static commandName = "make:admin-resource";
  static description = "Create an admin panel resource for a model";
  static needsApp = false;
  static args = [{ name: "name", required: true, description: "Model name (e.g. Product)" }];
  static flags: FlagDef[] = [
    {
      name: "cluster",
      type: "string",
      description: "Cluster class to file the resource under (e.g. ShopCluster)",
    },
    {
      name: "parent",
      type: "string",
      description: "Parent resource's model name, for a nested resource",
    },
    {
      name: "foreign-key",
      type: "string",
      description: "Foreign key linking to the parent (e.g. post_id)",
    },
    {
      name: "singular",
      type: "boolean",
      description: "Back a single row — no list, no create page",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const path = `app/admin/${name}Resource.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    const cluster = this.flags["cluster"] as string | undefined;
    const parent = this.flags["parent"] as string | undefined;
    const singular = Boolean(this.flags["singular"]);
    const foreignKey =
      (this.flags["foreign-key"] as string | undefined) ?? defaultForeignKey(parent);

    if (parent && !foreignKey) {
      this.error("A nested resource needs --foreign-key (e.g. --foreign-key=post_id).");
      return;
    }

    await Bun.write(path, adminResourceStub({ name, cluster, parent, foreignKey, singular }));
    this.info(`Created: ${path}`);
    this.dim(`Register it in app/admin/index.ts:  Panel.register(${name}Resource)`);
    if (parent || cluster) {
      // The stub guesses flat paths; a panel split into folders needs them fixed.
      this.dim("Check the imports at the top if your panel is organised into folders.");
    }
  }
}

/** `Post` → `post_id`, the conventional foreign key naming. */
function defaultForeignKey(parent: string | undefined): string | undefined {
  if (!parent) return undefined;
  return `${parent.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}_id`;
}

export interface AdminResourceStubOptions {
  name: string;
  cluster?: string | undefined;
  parent?: string | undefined;
  foreignKey?: string | undefined;
  singular?: boolean | undefined;
}

/** Returns the source text of an admin resource for `name`. */
export function adminResourceStub(options: AdminResourceStubOptions): string {
  const { name, cluster, parent, foreignKey, singular } = options;

  // A singular resource has no list, so it needs neither the read-only view
  // schema nor an empty state — and importing what it doesn't use would leave
  // every generated file with a lint warning to clean up.
  const imports = ["Resource", "text", "textInput", "formSection"];
  if (!singular) imports.push("section", "textEntry", "createAction");

  const statics: string[] = [`  static override model = ${name};`];
  const extraImports: string[] = [`import { ${name} } from "@app/models/${name}";`];

  if (cluster) {
    statics.push(`  static override cluster = ${cluster};`);
    extraImports.push(`import { ${cluster} } from "@app/admin/clusters";`);
  }
  if (parent) {
    // The parent is named by a function: the two resources reference each other,
    // and a direct reference would be undefined on one side of the cycle.
    statics.push(
      `  static override parent = { resource: () => ${parent}Resource, foreignKey: "${foreignKey}" };`,
    );
    extraImports.push(`import { ${parent}Resource } from "@app/admin/${parent}Resource";`);
  }
  if (singular) {
    statics.push("  static override singular = true;");
  }
  statics.push('  static override navigationIcon = "collection";');
  statics.push('  static override recordTitleAttribute = "name";');

  const listBits = singular
    ? ""
    : `
  static override emptyState() {
    return {
      heading: "No ${pluralize(name).toLowerCase()} yet",
      description: "Describe what will fill this list, and how.",
      icon: "inbox",
      actions: [createAction()],
    };
  }
`;

  const infolist = singular
    ? ""
    : `
  static override infolist() {
    return [
      section("${name}")
        .columns(2)
        .schema([textEntry("name").weight("semibold").size("lg")]),
    ];
  }
`;

  return `import {
${imports.map((i) => `  ${i},`).join("\n")}
} from "@zerotal/admin";
${extraImports.join("\n")}

/**
 * The admin interface for {@link ${name}}.
 *
 * Register it in \`app/admin/index.ts\` and its pages exist: a list, a view, and
 * create/edit forms built from \`form()\`.
 */
export class ${name}Resource extends Resource {
${statics.join("\n")}

  static override columns() {
    return [
      text("id").sortable(),
      text("name").searchable().sortable(),
      text("createdAt").label("Created").sortable(),
    ];
  }

  static override form() {
    return [
      formSection("${name}")
        .columns(2)
        .schema([textInput("name").required().maxLength(120).columnSpan(2)]),
    ];
  }
${infolist}${listBits}}
`;
}
