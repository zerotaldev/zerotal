/**
 * The `make:package` command, which scaffolds a conformant `@zerotal/<name>`
 * workspace package on disk.
 */
import { Command } from "../Command.ts";
import { scaffoldPackage, packageNames } from "../../build/PackageScaffold.ts";

/**
 * `bun zt make:package <name>` — scaffolds a conformant `@zerotal/<name>`
 * workspace package on disk.
 *
 * @category Scaffolding (make:*)
 */
export class MakePackageCommand extends Command {
  static commandName = "make:package";
  static description = "Scaffold a conformant @zerotal/<name> package";
  static needsApp = false;
  static args = [
    { name: "name", required: true },
    { name: "baseDir", required: false, default: "./packages" },
  ];
  static flags = [];

  async run(): Promise<void> {
    const rawName = this.args["name"]!;
    const baseDir = (this.args["baseDir"] as string | undefined) || "./packages";
    const { token } = packageNames(rawName);
    if (!token) {
      this.error(`Invalid package name: "${rawName}"`);
      return;
    }
    const packageDir = `${baseDir}/${token}`;
    if (await Bun.file(`${packageDir}/package.json`).exists()) {
      this.error(`Package already exists: ${packageDir}`);
      return;
    }
    const files = scaffoldPackage(rawName);
    for (const [relativePath, content] of files)
      await Bun.write(`${packageDir}/${relativePath}`, content);
    this.section(`Created @zerotal/${token}`);
    for (const relativePath of files.keys()) this.info(`  ${packageDir}/${relativePath}`);
    this.newLine();
    this.line(`Next: add it to your app's providers, then run 'bun zerotal lint:packages'.`);
  }
}
