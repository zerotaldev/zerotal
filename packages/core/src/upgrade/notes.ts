/**
 * Release notes between two versions, read from the changelogs the installed packages ship.
 *
 * An app that carries workarounds has no way to ask which of them a release made unnecessary,
 * short of reading every changelog between two versions. The entries already say what used to
 * fail, so the useful part is finding them: `zt upgrade --notes --grep smtp` answers "is the
 * STARTTLS workaround still needed" in one command. This is a reader, not new bookkeeping.
 */
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { compareVersions } from "./types.ts";

/** One changelog entry, with the package and release that shipped it. */
export interface ReleaseNote {
  version: string;
  package: string;
  /** The section it was under: `Fixed`, `Added`, `Changed`, `BREAKING`, … */
  category: string;
  /** The bold lead of the entry, or its first line. */
  title: string;
  /** The whole entry, as written. */
  text: string;
}

/** The order a reader wants: what breaks first, then what was fixed. */
const CATEGORY_ORDER = ["BREAKING", "Fixed", "Added", "Changed", "Security", "Removed"];

function _category(heading: string): string {
  if (heading.includes("BREAKING")) return "BREAKING";
  return heading.replace(/^#+\s*/, "").split(/\s+/)[0] ?? heading;
}

function _title(text: string): string {
  const bold = /^\*\*(.+?)\*\*/s.exec(text);
  const lead = bold ? bold[1]! : (text.split("\n")[0] ?? "");
  return lead.replace(/\s+/g, " ").trim();
}

/**
 * Every released entry in one package's changelog. `[Unreleased]` is skipped: it describes no
 * version anybody can be on.
 */
export function parseChangelog(markdown: string, packageName: string): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  let version: string | undefined;
  let category = "";
  let entry: string[] | undefined;

  const flush = (): void => {
    if (entry && version) {
      const text = entry.join("\n").trim();
      if (text) notes.push({ version, package: packageName, category, title: _title(text), text });
    }
    entry = undefined;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const release = /^## \[?(\d+\.\d+\.\d+)\]?/.exec(line);
    if (release || /^## /.test(line)) {
      flush();
      version = release?.[1];
      category = "";
      continue;
    }
    if (/^### /.test(line)) {
      flush();
      category = _category(line);
      continue;
    }
    if (line.startsWith("- ")) {
      flush();
      entry = [line.slice(2)];
      continue;
    }
    if (entry && (line === "" || /^\s/.test(line))) entry.push(line.trim());
    else flush();
  }
  flush();
  return notes;
}

/**
 * The changelogs of the Zerotal packages installed for an app: `zerotal` and every `@zerotal/*`,
 * read from disk because each package ships its own.
 *
 * Looked up the way a module is resolved, from the app's `node_modules` towards the filesystem
 * root, nearest copy first: an app inside a workspace has some packages hoisted to the workspace's
 * `node_modules`, and reading only its own would miss them.
 */
export async function installedChangelogs(
  root: string,
): Promise<Array<{ package: string; markdown: string }>> {
  const found = new Map<string, string>();
  const read = async (dir: string, name: string): Promise<void> => {
    if (found.has(name)) return;
    const file = Bun.file(join(dir, "CHANGELOG.md"));
    if (await file.exists()) found.set(name, await file.text());
  };

  let dir = resolve(root);
  for (;;) {
    const modules = join(dir, "node_modules");
    await read(join(modules, "zerotal"), "zerotal");
    let scoped: string[] = [];
    try {
      scoped = readdirSync(join(modules, "@zerotal"));
    } catch {
      // Nothing installed at this level.
    }
    for (const name of scoped) await read(join(modules, "@zerotal", name), `@zerotal/${name}`);

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...found]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, markdown]) => ({ package: name, markdown }));
}

/**
 * The entries shipped after `from` and up to `to`, optionally only those mentioning `grep`, in the
 * order a reader wants them: by category, then newest first.
 */
export function notesBetween(
  notes: ReadonlyArray<ReleaseNote>,
  from: string,
  to: string,
  grep?: string | undefined,
): ReleaseNote[] {
  const needle = grep?.toLowerCase();
  const rank = (category: string): number => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return notes
    .filter((note) => compareVersions(note.version, from) > 0)
    .filter((note) => compareVersions(note.version, to) <= 0)
    .filter((note) => !needle || note.text.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        rank(a.category) - rank(b.category) ||
        compareVersions(b.version, a.version) ||
        a.package.localeCompare(b.package),
    );
}

/** The newest version any of the notes mention, which is what is installed. */
export function newestVersion(notes: ReadonlyArray<ReleaseNote>): string | undefined {
  return notes
    .map((note) => note.version)
    .sort(compareVersions)
    .at(-1);
}
