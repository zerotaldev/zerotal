/**
 * The `make:provider` command, which scaffolds a service provider and (unless
 * skipped) wires it into `bootstrap/providers.ts`.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { _frameworkImport } from "../appSource.ts";
import { registerProvider } from "../../build/codemod.ts";

/**
 * The generated file.
 *
 * @internal
 */
export function _providerStub(name: string, core = "zerotal"): string {
  return `import { ServiceProvider } from "${core}";

export class ${name} extends ServiceProvider {
  override onRegister(): void {
    // Bind singletons into the container here.
    // this.app.container.singleton("my-service", () => new MyService());
  }

  override async onBooting(): Promise<void> {
    // Called after all providers are registered.
    // Safe to resolve other bindings from the container.
  }

  override async onBooted(): Promise<void> {
    // Called after all providers have finished booting.
    // Use for cross-provider wiring (e.g. registering commands, events).
  }
}
`;
}

/**
 * `bun zt make:provider <name>` — scaffolds a new service provider class under
 * `app/providers/` and (unless skipped) wires it into `bootstrap/providers.ts`.
 *
 * @category Scaffolding (make:*)
 */
export class MakeProviderCommand extends GeneratorCommand {
  static override commandName = "make:provider";
  static override description = "Create a new service provider class";
  static override args = [
    {
      name: "name",
      required: true,
      description: "Provider name (e.g. Payment or PaymentProvider)",
    },
  ];
  static override flags = [
    {
      name: "no-register",
      type: "boolean" as const,
      description: "Skip registering in bootstrap/providers.ts",
      default: false,
    },
  ];

  protected override async generate(): Promise<void> {
    const name = this.args["name"]!;
    const className = name.endsWith("Provider") ? name : `${name}Provider`;
    const path = `app/providers/${className}.ts`;
    if (!(await this.writeFile(path, _providerStub(className, _frameworkImport("@zerotal/core")))))
      return;

    // Codemod: wire the new provider into bootstrap/providers.ts.
    if (this.flags["no-register"] !== true) {
      if (this.dryRun) {
        this.info(`Would register ${className} in bootstrap/providers.ts`);
      } else {
        const result = await registerProvider({
          className,
          importPath: `../app/providers/${className}.ts`,
        });
        if (result === "added") this.info("Registered in bootstrap/providers.ts");
        if (result === "exists") this.info("Already registered in bootstrap/providers.ts");
        if (result === "missing")
          this.warn("bootstrap/providers.ts not found — add the provider manually.");
      }
    }
    this.next(
      `Bind what it provides in onRegister(), and resolve it from the container where it is used.`,
    );
  }
}
