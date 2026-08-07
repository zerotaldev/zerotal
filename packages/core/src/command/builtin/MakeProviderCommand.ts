/**
 * The `make:provider` command, which scaffolds a service provider and (unless
 * skipped) wires it into `bootstrap/providers.ts`.
 */
import { Command } from "../Command.ts";
import { registerProvider } from "../../build/codemod.ts";

function providerStub(name: string): string {
  return `import { ServiceProvider } from '@zerotal/core';

export class ${name} extends ServiceProvider {
  override onRegister(): void {
    // Bind singletons into the container here.
    // this.app.container.singleton('my-service', () => new MyService());
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
export class MakeProviderCommand extends Command {
  static commandName = "make:provider";
  static description = "Create a new service provider class";
  static needsApp = false;
  static args = [{ name: "name", required: true }];
  static flags = [
    {
      name: "no-register",
      type: "boolean" as const,
      description: "Skip registering in bootstrap/providers.ts",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const name = this.args["name"]!;
    const className = name.endsWith("Provider") ? name : `${name}Provider`;
    const path = `app/providers/${className}.ts`;

    if (await Bun.file(path).exists()) {
      this.error(`File already exists: ${path}`);
      return;
    }

    await Bun.write(path, providerStub(className));
    this.info(`Created: ${path}`);

    // Codemod: wire the new provider into bootstrap/providers.ts.
    if (this.flags["no-register"] !== true) {
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
}
