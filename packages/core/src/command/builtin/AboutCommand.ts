import { readdirSync, readFileSync } from "node:fs";
import { Command } from "../Command.ts";
import { _versionInfo } from "../versionInfo.ts";

/** One installed framework package. */
export interface _AboutPackage {
  name: string;
  version: string;
  /** Declared in the app's own `package.json`, rather than arriving through `zerotal`. */
  direct: boolean;
}

/** A framework package this app does not have, and what installing it would give it. */
export interface _AboutAvailable {
  pkg: string;
  /** The needs it covers, as the capability index names them. */
  needs: string[];
  /** The docs page for the first of them. */
  doc: string;
}

/** Everything `zt about` reports. */
export interface _AboutReport {
  zerotal: string;
  bun: string;
  app: { name: string; version: string } | null;
  installed: _AboutPackage[];
  /** `null` when `@zerotal/arch`, which carries the capability index, is not installed. */
  available: _AboutAvailable[] | null;
}

/** The fields of a capability `about` reads; the full shape lives in `@zerotal/arch`. */
interface CapabilityLike {
  need: string;
  pkg?: string | undefined;
  doc: string;
}

/**
 * `bun zt about` — what this app has installed, and what else the framework ships.
 *
 * Two questions people kept answering by hand. "Which Zerotal packages are in this
 * app, at which versions" meant reading `package.json` and `node_modules`; "is there a
 * package for this" meant reading the docs, or not asking and building it. The second
 * is the expensive one: an app wrote tenant scoping, roles and an audit log by hand
 * beside framework packages that do all three.
 *
 * The installed list is read from disk and needs nothing but the app. The
 * available list comes from the capability index in `@zerotal/arch` — the same list
 * `AGENTS.md` and the "What ships" page are generated from — which core cannot depend
 * on, so it is loaded when the app has it and named as missing when it does not.
 * Needs no booted app, so it answers when the app does not boot.
 *
 * @example
 * ```bash
 * bun zt about
 * bun zt about --json
 * ```
 *
 * @category Diagnostics
 */
export class AboutCommand extends Command {
  static commandName = "about";
  static description = "List installed Zerotal packages and what else the framework ships";
  static needsApp = false;
  static args = [];
  static flags = [
    {
      name: "json",
      type: "boolean" as const,
      description: "Print as JSON",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const report = await _aboutReport(process.cwd());

    if (this.flags["json"] === true) {
      this.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    this.write(`${_formatAbout(report)}\n`);
  }
}

/**
 * Build the report for the app at `cwd`.
 *
 * @param loadCapabilities - Where the capability index comes from; the default
 *   imports `@zerotal/arch` from the app and answers `null` when it is not there.
 * @internal
 */
export async function _aboutReport(
  cwd: string,
  loadCapabilities: (cwd: string) => Promise<readonly CapabilityLike[] | null> = _archCapabilities,
): Promise<_AboutReport> {
  const version = _versionInfo(cwd);
  const installed = _installedPackages(cwd);
  const capabilities = await loadCapabilities(cwd);

  let available: _AboutAvailable[] | null = null;
  if (capabilities !== null) {
    const have = new Set(installed.map((p) => p.name));
    const byPkg = new Map<string, _AboutAvailable>();
    for (const capability of capabilities) {
      if (capability.pkg === undefined || have.has(capability.pkg)) continue;
      const entry = byPkg.get(capability.pkg) ?? {
        pkg: capability.pkg,
        needs: [],
        doc: capability.doc,
      };
      entry.needs.push(capability.need);
      byPkg.set(capability.pkg, entry);
    }
    available = [...byPkg.values()].sort((a, b) => a.pkg.localeCompare(b.pkg));
  }

  return {
    zerotal: version.zerotal,
    bun: version.bun,
    app: version.app,
    installed,
    available,
  };
}

/**
 * The framework packages in this app's `node_modules`, plus the ones the `zerotal`
 * bundle brings, which a workspace install may have hoisted out of it.
 *
 * Listed with `readdirSync` rather than a glob: in a workspace every package is a
 * symlink, and a glob does not descend into one.
 *
 * @internal
 */
export function _installedPackages(cwd: string): _AboutPackage[] {
  const declared = _declared(cwd);
  const found = new Map<string, _AboutPackage>();

  const read = (dir: string): void => {
    const manifest = _manifest(`${dir}/package.json`);
    if (!manifest || typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      return;
    }
    found.set(manifest.name, {
      name: manifest.name,
      version: manifest.version,
      direct: declared.has(manifest.name),
    });
  };

  read(`${cwd}/node_modules/zerotal`);
  try {
    for (const name of readdirSync(`${cwd}/node_modules/@zerotal`)) {
      read(`${cwd}/node_modules/@zerotal/${name}`);
    }
  } catch {
    /* no scoped packages here */
  }

  // The bundle's own dependencies are installed wherever the install put them. The
  // bundle being here is the evidence; versions move in lockstep, so its version is
  // theirs.
  const bundle = found.get("zerotal");
  if (bundle) {
    const deps = _manifest(`${cwd}/node_modules/zerotal/package.json`)?.dependencies ?? {};
    for (const name of Object.keys(deps)) {
      if (!name.startsWith("@zerotal/") || found.has(name)) continue;
      found.set(name, { name, version: bundle.version, direct: declared.has(name) });
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Format the report for a terminal: plain text, because it gets pasted into issues. */
export function _formatAbout(report: _AboutReport): string {
  const lines: string[] = [];
  const app = report.app ? `  ·  ${report.app.name} ${report.app.version}` : "";
  lines.push(`Zerotal ${report.zerotal}  ·  Bun ${report.bun}${app}`, "");

  lines.push("Installed");
  if (report.installed.length === 0) {
    lines.push("  (no Zerotal packages in node_modules — run `bun install`)");
  } else {
    const width = Math.max(...report.installed.map((p) => p.name.length));
    for (const pkg of report.installed) {
      const via = pkg.direct || pkg.name === "zerotal" ? "" : "  (through zerotal)";
      const drift = pkg.version !== report.zerotal ? `  ← not ${report.zerotal}` : "";
      lines.push(`  ${pkg.name.padEnd(width)}  ${pkg.version}${via}${drift}`);
    }
  }
  if (report.installed.some((p) => p.version !== report.zerotal)) {
    lines.push(
      "",
      "  Zerotal packages are released together, at one version, and tested that way. Give",
      "  each the same version in package.json and run `bun install`.",
    );
  }

  lines.push("", "Available, not installed");
  if (report.available === null) {
    lines.push(
      "  The capability index ships with @zerotal/arch, which this app does not have.",
      "  Add it with `bun add @zerotal/arch`, or read https://zerotal.dev/docs/what-ships.",
    );
  } else if (report.available.length === 0) {
    lines.push("  Nothing: every package the framework ships for a listed need is installed.");
  } else {
    for (const entry of report.available) {
      lines.push(`  ${entry.pkg}`);
      lines.push(`    ${entry.needs.join("; ")}`);
      lines.push(`    bun add ${entry.pkg}  ·  https://zerotal.dev/docs/${entry.doc}`);
    }
  }

  return lines.join("\n");
}

/** The app's direct dependencies. */
function _declared(cwd: string): Set<string> {
  const manifest = _manifest(`${cwd}/package.json`);
  return new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ]);
}

function _manifest(path: string):
  | {
      name?: unknown;
      version?: unknown;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }
  | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ReturnType<typeof _manifest>;
  } catch {
    return undefined;
  }
}

/**
 * The capability index from the app's `@zerotal/arch`, or `null` without one.
 *
 * Resolved from the app's directory, not from core's: core does not depend on arch,
 * and the copy that matters is the one this app installed. The specifier is a
 * variable so it stays a runtime lookup rather than a compile-time dependency.
 */
async function _archCapabilities(cwd: string): Promise<readonly CapabilityLike[] | null> {
  const specifier = "@zerotal/arch";
  let path: string;
  try {
    path = Bun.resolveSync(specifier, cwd);
  } catch {
    return null;
  }
  try {
    const arch = (await import(path)) as { CAPABILITIES?: readonly CapabilityLike[] };
    return Array.isArray(arch.CAPABILITIES) ? arch.CAPABILITIES : null;
  } catch {
    return null;
  }
}
