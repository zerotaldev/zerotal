/**
 * The `make:policy` command and the authorization-policy source stub it writes.
 */
import { Command } from "../Command.ts";
import { _frameworkImport, _readModel, _relativeImport, _writeAppSource } from "../appSource.ts";

/** What {@link policyStub} is told about the app. */
export interface PolicyStubOptions {
  /** The specifier `Policy` is imported by. `zerotal/auth` unless given. */
  auth?: string | undefined;
  /** The model's import, relative to the policy. `../models/<Model>.ts` unless given. */
  modelImport?: string | undefined;
  /**
   * The user model's import, relative to the policy, or `false` when the app has no `User`
   * model (the user is then typed by the one field a check reads, its `id`).
   */
  userImport?: string | false | undefined;
  /**
   * The model's property naming its owner (`userId`). With one, a user may see, change and
   * delete only their own records; without, every check allows, and says where to decide.
   */
  owner?: string | undefined;
}

/** `Task` → `task`, the name a check calls the record it is asked about. */
function variableFor(model: string): string {
  const name = model.charAt(0).toLowerCase() + model.slice(1);
  // A model called `User` would shadow the user parameter.
  return name === "user" ? "record" : name;
}

/**
 * Source for a new authorization policy class extending `Policy<Model>`.
 *
 * The checks are typed by the app's own `User` and model classes. With an owner column, they are
 * the starters' rule: anyone signed in may create, and only the owner may see, change or delete.
 */
export function policyStub(name: string, model: string, options: PolicyStubOptions = {}): string {
  const auth = options.auth ?? "zerotal/auth";
  const modelImport = options.modelImport ?? `../models/${model}.ts`;
  const userImport = options.userImport ?? "../models/User.ts";
  const record = variableFor(model);
  const userType = userImport === false ? "{ id: number }" : "User";
  const imports = [
    `import { Policy } from "${auth}";`,
    `import type { ${model} } from "${modelImport}";`,
    ...(userImport === false ? [] : [`import type { User } from "${userImport}";`]),
  ].join("\n");
  const owner = options.owner;
  const check = owner
    ? (verb: string) =>
        `  ${verb}(user: ${userType}, ${record}: ${model}): boolean {\n    return ${record}.${owner} === user.id;\n  }`
    : (verb: string) =>
        `  ${verb}(_user: ${userType}, _${record}: ${model}): boolean {\n` +
        `    // ${model} has no owner column, so nothing here can tell whose it is. Decide who may\n` +
        `    // ${verb} one, e.g. \`return ${record}.userId === user.id;\` once it has a userId.\n` +
        `    return true;\n  }`;
  const summary = owner
    ? `Who may do what with a ${record}: anyone signed in may create one, and only its owner\n * may see, change or delete it.`
    : `Who may do what with a ${record}.`;
  return `${imports}

/**
 * ${summary}
 *
 * Found by name — \`${name}\` for \`${model}\` — so \`Gate.authorize("update", ${record})\`
 * reaches it without being registered. A denial is a 403.
 */
export class ${name} extends Policy<${model}> {
${check("view")}

  create(_user: ${userType}): boolean {
    return true;
  }

${check("update")}

${check("delete")}
}
`;
}

/**
 * `bun zt make:policy <name>` — scaffolds a new authorization policy class
 * under `app/policies/` (pass `--model`/`-m` to bind it to a model).
 *
 * @category Scaffolding (make:*)
 */
export class MakePolicyCommand extends Command {
  static commandName = "make:policy";
  static description = "Create a new authorization policy class";
  static needsApp = false;
  static args = [{ name: "name", required: true, description: "Policy name (e.g. PostPolicy)" }];
  static flags = [
    {
      name: "model",
      short: "m",
      type: "string" as const,
      description: "The model this policy is for (e.g. Post)",
      default: "",
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const model = (this.flags["model"] as string) || name.replace(/Policy$/, "");
    const path = `app/policies/${name}.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    // The model and the user are read from app/models/, so the checks are typed by the app's
    // own classes and compare the model's real owner column. The stub used to ignore --model
    // entirely: `Policy<unknown>`, the imports commented out, and every check `return true`.
    const shape = _readModel(model);
    const user = model === "User" ? shape : _readModel("User");
    await _writeAppSource(
      path,
      policyStub(name, model, {
        auth: _frameworkImport("@zerotal/auth"),
        modelImport: `${_relativeImport(path, shape?.file ?? `app/models/${model}`)}.ts`,
        userImport: user ? `${_relativeImport(path, user.file)}.ts` : false,
        ...(shape?.owner ? { owner: shape.owner.property } : {}),
      }),
    );
    this.info(`Created: ${path}`);

    if (!shape) {
      this.warn(
        `  No model exports ${model} in app/models/. The policy imports it from ` +
          `app/models/${model}.ts; run \`bun zt make:model ${model}\`, or pass --model.`,
      );
    } else if (!shape.owner) {
      this.warn(
        `  ${model} has no userId column, so the policy cannot tell whose a ${variableFor(model)} ` +
          `is and allows every check. Add an owner column, or write the rules in ${path}.`,
      );
    }
  }
}
