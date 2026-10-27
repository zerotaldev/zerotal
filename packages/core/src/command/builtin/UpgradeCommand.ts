import { Command } from "../Command.ts";
import { CODEMODS } from "../../upgrade/codemods/index.ts";
import { planUpgrade, applyPlan } from "../../upgrade/runner.ts";
import { compareVersions } from "../../upgrade/types.ts";
import {
  installedChangelogs,
  newestVersion,
  notesBetween,
  parseChangelog,
} from "../../upgrade/notes.ts";

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
    {
      name: "notes",
      short: "n",
      type: "boolean" as const,
      description: "Print the release notes between the two versions instead of running codemods",
      default: false,
    },
    {
      name: "grep",
      type: "string" as const,
      description: "With --notes, only the entries that mention this text",
      default: "",
    },
    {
      name: "json",
      short: "j",
      type: "boolean" as const,
      description: "With --notes, print the entries as JSON",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const root = (this.flags["path"] as string) || ".";
    if (this.flags["notes"]) {
      await this.printNotes(root);
      return;
    }
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

  /**
   * `--notes`: what shipped between the version the app declares and the one installed, from the
   * changelogs the installed packages carry. Read-only.
   *
   * An app keeps a workaround long after the release that made it unnecessary, because nothing
   * tells it; its comment hardens into a belief about the framework that is no longer true. The
   * changelog entries say what used to fail, so `--grep smtp` is how one is checked.
   */
  private async printNotes(root: string): Promise<void> {
    const changelogs = await installedChangelogs(root);
    if (changelogs.length === 0) {
      this.error(
        `No Zerotal changelogs under ${root}/node_modules. Run this in an app with zerotal installed, ` +
          `or pass --path.`,
      );
      process.exitCode = 1;
      return;
    }
    const all = changelogs.flatMap(({ package: name, markdown }) => parseChangelog(markdown, name));

    const from = ((this.flags["from"] as string) || (await this.installedVersion(root))).trim();
    const to = ((this.flags["to"] as string) || newestVersion(all) || "").trim();
    if (!/^\d+\.\d+\.\d+$/.test(from) || !/^\d+\.\d+\.\d+$/.test(to)) {
      this.error(
        `Cannot tell which versions to compare. Pass --from <version> (and --to, if not the ` +
          `installed one), or run this in a project whose package.json depends on zerotal.`,
      );
      process.exitCode = 1;
      return;
    }

    const grep = (this.flags["grep"] as string) || undefined;
    const notes = notesBetween(all, from, to, grep);
    if (this.flags["json"]) {
      // Raw, not through line(): that colours its text, and colour codes are not JSON.
      this.write(`${JSON.stringify(notes, null, 2)}\n`);
      return;
    }

    const matching = grep ? ` mentioning "${grep}"` : "";
    if (notes.length === 0) {
      this.info(`No release notes${matching} after ${from}, up to ${to}.`);
      return;
    }
    this.info(`Release notes after ${from}, up to ${to}${matching}`);
    let category = "";
    for (const note of notes) {
      if (note.category !== category) {
        category = note.category;
        this.line("");
        this.line(category);
      }
      this.line(`  ${note.version.padEnd(8)} ${note.package.padEnd(24)} ${note.title}`);
    }
    this.line("");
    this.dim(
      `${notes.length} entr${notes.length === 1 ? "y" : "ies"}. The full text of each is in the ` +
        `package's CHANGELOG.md, or run with --json.`,
    );
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
