/**
 * The `make:package` command, which scaffolds a conformant `@zerotal/<name>`
 * workspace package on disk.
 */
import { GeneratorCommand } from "../GeneratorCommand.ts";
import { scaffoldPackage, packageNames } from "../../build/PackageScaffold.ts";

/**
 * `bun zt make:package <name>` — scaffolds a conformant `@zerotal/<name>`
 * workspace package on disk.
 *
 * @category Scaffolding (make:*)
 */
export class MakePackageCommand extends GeneratorCommand {
  static override commandName = "make:package";
  static override description = "Scaffold a conformant @zerotal/<name> package";
  static override args = [
    { name: "name", required: true },
    { name: "baseDir", required: false, default: "./packages" },
  ];
  // Normalised to a package token below (`@zerotal/Billing` is `billing`), so the name is checked
  // there rather than as a class name.
  static override nameArgument: string | undefined = undefined;

  protected override async generate(): Promise<void> {
    const rawName = this.args["name"]!;
    const baseDir = ((this.args["baseDir"] as string | undefined) || "./packages")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "");
    const { token } = packageNames(rawName);
    if (!token) return this.refuse(`Invalid package name: "${rawName}"`);
    const packageDir = `${baseDir}/${token}`;
    if (!this.force && (await Bun.file(`${packageDir}/package.json`).exists())) {
      return this.refuse(`Package already exists: ${packageDir} (pass --force to overwrite it)`);
    }
    const files = scaffoldPackage(rawName);
    // Every file is checked before any is written, so a refusal leaves no half-made package.
    for (const relativePath of files.keys()) {
      if (!(await this.canWrite(`${packageDir}/${relativePath}`))) return;
    }
    this.section(`${this.dryRun ? "Would create" : "Created"} @zerotal/${token}`);
    for (const [relativePath, content] of files)
      await this.writeFile(`${packageDir}/${relativePath}`, content, { format: false });
    this.next(
      `Register its provider in your app's bootstrap/providers.ts.`,
      `Check it against the package conventions: bun zt lint:packages`,
    );
  }
}
