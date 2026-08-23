import { Command } from "../Command.ts";
import { CODEMODS } from "../../upgrade/codemods/index.ts";
import { planUpgrade, applyPlan } from "../../upgrade/runner.ts";
import { compareVersions } from "../../upgrade/types.ts";

/**
 * `bun zt upgrade` — carry an app across a version boundary.
 *
 * Every breaking change the framework wants to make waits in the 2.0 ledger, and
 * the rule attached to that ledger is that anything which *can* have a codemod
 * has one before 2.0 ships. This is the runner those codemods plug into; without
 * it the ledger is a list of things nobody can afford to pay.
 *
 * ## Dry by default
 *
 * It prints the plan and writes nothing unless asked. That is the opposite of
 * most tools and deliberate: this rewrites source across a whole project, and
 * the first run should be something a person can read and disagree with. `--write`
 * is one word, and by the time somebody types it they have seen the diff summary.
 *
 * ## The report is the product
 *
 * Anyone can rewrite `BaseModel` to `Model` with `sed`. What makes an upgrade
 * tool worth running is the part that says "these eleven places I did not touch,
 * and here is why" — a codemod that silently walks past what it does not
 * understand is worse than none, because the changes it *did* make imply the job
 * is finished.
 *
 * @category Maintenance
 */
export class UpgradeCommand extends Command {
  static commandName = "upgrade";
  static description = "Apply the codemods for a version upgrade";
  static needsApp = false;

  static flags = [
    {
      name: "from",
      type: "string" as const,
      description: "Version being upgraded from (defaults to the installed zerotal version)",
      default: "",
    },
    {
      name: "to",
      type: "string" as const,
      description: "Version being upgraded to",
      default: "",
    },
    {
      name: "write",
      short: "w",
      type: "boolean" as const,
      description: "Apply the changes. Without this, the plan is printed and nothing is written",
      default: false,
    },
    {
      name: "path",
      short: "p",
      type: "string" as const,
      description: "Directory to upgrade",
      default: ".",
    },
  ];

  async run(): Promise<void> {
    const root = (this.flags["path"] as string) || ".";
    const write = this.flags["write"] as boolean;

    const from = ((this.flags["from"] as string) || (await this.installedVersion(root))).trim();
    const to = (this.flags["to"] as string).trim();

    if (!/^\d+\.\d+\.\d+$/.test(from)) {
      this.error(
        `Cannot tell which version this app is on. Pass --from <version>, or run this in a ` +
          `project whose package.json depends on zerotal.`,
      );
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(to)) {
      this.error("Pass the version you are upgrading to: --to <version>");
      return;
    }
    if (compareVersions(to, from) <= 0) {
      this.error(`--to (${to}) must be newer than --from (${from}).`);
      return;
    }

    const plan = await planUpgrade(root, CODEMODS, from, to);

    this.info(`Upgrade ${from} → ${to}`);
    this.dim(`  scanned ${plan.scanned} file(s) under ${root}`);

    if (plan.codemods.length === 0) {
      this.info("No codemods apply to this version range. Nothing to do.");
      return;
    }

    this.line("");
    this.line("Codemods:");
    for (const codemod of plan.codemods) {
      const ledger = codemod.ledger ? ` (ledger #${codemod.ledger})` : "";
      this.dim(`  ${codemod.version}  ${codemod.name}${ledger} — ${codemod.description}`);
    }

    this.line("");
    if (plan.changes.size === 0) {
      this.info("No files need changing.");
    } else {
      this.line(`${plan.changes.size} file(s) to change:`);
      for (const change of plan.changes.values()) this.dim(`  ${change.file} — ${change.summary}`);
    }

    // Last and loudest: the part a person has to act on.
    if (plan.manual.length > 0) {
      this.line("");
      this.warn(`${plan.manual.length} place(s) need a decision this cannot make for you:`);
      for (const item of plan.manual.slice(0, 20)) {
        this.dim(`  ${item.file}:${item.line}  ${item.text}`);
        this.dim(`    ${item.reason}`);
      }
      if (plan.manual.length > 20) this.dim(`  … and ${plan.manual.length - 20} more`);
    }

    this.line("");
    if (!write) {
      this.info("Dry run — nothing written. Re-run with --write to apply.");
      return;
    }

    const written = await applyPlan(root, plan);
    this.info(`Wrote ${written} file(s).`);
    this.dim("  Run your tests, then run this again — a second run should report no changes.");
  }

  /** The `zerotal` version this project depends on, if it says. */
  private async installedVersion(root: string): Promise<string> {
    try {
      const pkg = (await Bun.file(`${root}/package.json`).json()) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const spec = pkg.dependencies?.["zerotal"] ?? pkg.devDependencies?.["zerotal"] ?? "";
      return /(\d+\.\d+\.\d+)/.exec(spec)?.[1] ?? "";
    } catch {
      return "";
    }
  }
}
