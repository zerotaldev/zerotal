/**
 * `api_surface` — hand over the signature, not a description of it.
 *
 * Every `@zerotal/*` package commits an `api-surface.md`: the name, kind and
 * full type of every public export, extracted by the TypeScript checker and
 * diffed by CI on every change. It is the asset this whole package is built
 * around. A docs search can tell an agent that a fluent builder exists; this
 * tells it the exact call it must write for `tsc` to accept it.
 *
 * The file is read from the *installed* package — `node_modules/@zerotal/<pkg>`
 * — so the answer describes the version this app actually runs. Inside the
 * framework's own monorepo it falls back to `packages/<pkg>`, which is the same
 * file by another path.
 */
import { join } from "node:path";
import type { ArchTool, ToolOutcome } from "../mcp/types.ts";
import type { ToolContext } from "./context.ts";

/** One exported symbol, as recorded in the snapshot. */
export interface SurfaceEntry {
  /** The subpath it is exported from, e.g. `.` or `./config`. */
  subpath: string;
  /** `class` | `interface` | `type` | `function` | `const` | `enum` | `namespace` | `value`. */
  kind: string;
  name: string;
  /** The full rendered signature, class bodies included. */
  signature: string;
}

/** A line that opens an entry: `class Foo = {`, `function bar = (…) => …`. */
const ENTRY_START = /^(class|interface|type|enum|function|namespace|const|value) (\S+) = ?(.*)$/;
/** A section heading: `## ./config  \`(src/config/index.ts)\`` */
const SECTION_START = /^## (\S+)/;

/**
 * Parse a committed `api-surface.md` into its entries.
 *
 * Line-driven rather than split-on-blank-line: a rendered class body is
 * multi-line, and a signature that happened to contain a blank line would
 * silently truncate the export it belongs to.
 */
export function parseSurface(markdown: string): SurfaceEntry[] {
  const entries: SurfaceEntry[] = [];
  let subpath = ".";
  let current: SurfaceEntry | undefined;
  let body: string[] = [];

  const flush = (): void => {
    if (!current) return;
    // Trailing blank lines are separators between entries, not part of one.
    while (body.length > 0 && body[body.length - 1]!.trim() === "") body.pop();
    entries.push({ ...current, signature: [current.signature, ...body].join("\n").trim() });
    current = undefined;
    body = [];
  };

  for (const line of markdown.split("\n")) {
    const section = SECTION_START.exec(line);
    if (section) {
      flush();
      subpath = section[1]!;
      continue;
    }

    const start = ENTRY_START.exec(line);
    if (start) {
      flush();
      current = { subpath, kind: start[1]!, name: start[2]!, signature: start[3] ?? "" };
      continue;
    }

    if (current) body.push(line);
  }
  flush();

  return entries;
}

/** Accept `core`, `@zerotal/core`, or the meta-package `zerotal`. */
export function normalisePackageName(raw: string): { scoped: string; dir: string } {
  const trimmed = raw.trim().replace(/^@zerotal\//, "");
  if (trimmed === "zerotal") return { scoped: "zerotal", dir: "zerotal" };
  return { scoped: `@zerotal/${trimmed}`, dir: trimmed };
}

/**
 * Where this project's copy of a package's snapshot lives.
 *
 * `node_modules` first: that is the version the app is running, and the only
 * one whose signatures are the truth for the code being written. The workspace
 * path is the fallback for the framework's own repo, where there is no install
 * to read.
 */
export async function findSurfaceFile(
  root: string,
  raw: string,
): Promise<{ path: string; scoped: string } | undefined> {
  const { scoped, dir } = normalisePackageName(raw);
  const candidates = [
    join(root, "node_modules", scoped, "api-surface.md"),
    join(root, "packages", dir, "api-surface.md"),
  ];
  for (const path of candidates) {
    if (await Bun.file(path).exists()) return { path, scoped };
  }
  return undefined;
}

/**
 * Every package whose snapshot this project can serve, for the "did you mean" list.
 *
 * `node_modules` is listed rather than globbed: in a workspace each
 * `@zerotal/*` entry is a symlink to the package directory, and glob traversal
 * does not descend into one — so the suggestion list came back empty in exactly
 * the layout a framework contributor works in. `packages/` is a real tree and is
 * globbed as before.
 */
async function availablePackages(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const names = new Set<string>();

  const linked = [`${root}/node_modules/zerotal`];
  try {
    for (const name of await readdir(`${root}/node_modules/@zerotal`)) {
      linked.push(`${root}/node_modules/@zerotal/${name}`);
    }
  } catch {
    /* nothing installed under the scope */
  }
  for (const dir of linked) {
    if (!(await Bun.file(`${dir}/api-surface.md`).exists())) continue;
    const base = dir.split(/[\\/]/).pop() ?? "";
    names.add(base === "zerotal" ? "zerotal" : `@zerotal/${base}`);
  }

  try {
    for await (const file of new Bun.Glob("packages/*/api-surface.md").scan({
      cwd: root,
      onlyFiles: true,
    })) {
      const parts = file.split(/[\\/]/);
      const dir = parts[parts.length - 2] ?? "";
      names.add(dir === "zerotal" ? "zerotal" : `@zerotal/${dir}`);
    }
  } catch {
    /* a pattern that matches nothing contributes nothing */
  }

  return [...names].sort();
}

export function apiSurfaceTool(ctx: ToolContext): ArchTool {
  return {
    name: "api_surface",
    title: "API surface",
    description:
      "The exact public API of a Zerotal package: every export with its full TypeScript " +
      "signature, including class members and static properties. This is the mechanical " +
      "record CI diffs on every change, read from the version installed in this project — " +
      "prefer it over recalling an API from memory. Pass `symbol` alone to find an export " +
      "when you do not know which package owns it; add `package` to narrow.",
    inputSchema: {
      type: "object",
      properties: {
        package: {
          type: "string",
          description:
            'Package name, with or without the scope — "core" or "@zerotal/core". ' +
            "Omit to search every installed package.",
        },
        symbol: {
          type: "string",
          description:
            "Only return exports whose name contains this, case-insensitively. Omit for all.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        package: { type: "string" },
        total: { type: "number" },
        matched: { type: "number" },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              subpath: { type: "string" },
              kind: { type: "string" },
              name: { type: "string" },
              signature: { type: "string" },
            },
            required: ["subpath", "kind", "name", "signature"],
          },
        },
      },
      required: ["package", "total", "matched", "entries"],
    },

    async run(args): Promise<ToolOutcome> {
      const requested = typeof args["package"] === "string" ? args["package"].trim() : "";
      const filter = typeof args["symbol"] === "string" ? args["symbol"].toLowerCase() : undefined;

      // No package named: search them all for the symbol.
      //
      // Requiring one assumed the caller already knew where an export lived,
      // which is the opposite of the situation that sends someone here — you
      // reach for this tool *because* you are unsure, and being made to guess a
      // package first is how you end up guessing the signature instead.
      if (requested.length === 0) {
        if (filter === undefined || filter.length === 0) {
          return {
            text: "Pass `symbol` to search every package, or `package` to list one.",
            failed: true,
          };
        }
        return searchEverywhere(ctx.root, args["symbol"] as string, filter);
      }

      const found = await findSurfaceFile(ctx.root, requested);
      if (!found) {
        const available = await availablePackages(ctx.root);
        return {
          text:
            `No API surface for "${requested}" in this project.` +
            (available.length > 0 ? `\n\nAvailable: ${available.join(", ")}` : ""),
          failed: true,
        };
      }

      const all = parseSurface(await Bun.file(found.path).text());
      const entries =
        filter === undefined || filter.length === 0
          ? all
          : all.filter((entry) => entry.name.toLowerCase().includes(filter));

      if (entries.length === 0) {
        return {
          text: `${found.scoped} exports nothing matching "${args["symbol"] as string}".`,
          data: { package: found.scoped, total: all.length, matched: 0, entries: [] },
        };
      }

      return {
        text: render(found.scoped, entries, all.length),
        data: {
          package: found.scoped,
          total: all.length,
          matched: entries.length,
          entries,
        },
      };
    },
  };
}

function render(pkg: string, entries: SurfaceEntry[], total: number): string {
  const bySubpath = new Map<string, SurfaceEntry[]>();
  for (const entry of entries) {
    const list = bySubpath.get(entry.subpath) ?? [];
    list.push(entry);
    bySubpath.set(entry.subpath, list);
  }

  const header =
    entries.length === total
      ? `${pkg} — ${total} public export${total === 1 ? "" : "s"}`
      : `${pkg} — ${entries.length} of ${total} exports`;

  const sections = [...bySubpath].map(([subpath, list]) => {
    const importPath = subpath === "." ? pkg : `${pkg}${subpath.slice(1)}`;
    const body = list.map((entry) => `${entry.kind} ${entry.name} = ${entry.signature}`);
    return `## import from "${importPath}"\n\n${body.join("\n\n")}`;
  });

  return `${header}\n\n${sections.join("\n\n")}`;
}

/**
 * Find a symbol without being told which package it lives in.
 *
 * The narrow form answers "what is the signature of X in package Y". This one
 * answers "where is X, and what is its signature" — the question you actually
 * have when an API you half-remember turns out not to exist. Matches are
 * grouped by package so an ambiguous name shows every owner rather than the
 * first.
 */
async function searchEverywhere(
  root: string,
  symbol: string,
  filter: string,
): Promise<ToolOutcome> {
  const packages = await availablePackages(root);
  const hits: { package: string; entries: SurfaceEntry[] }[] = [];

  for (const name of packages) {
    const found = await findSurfaceFile(root, name);
    if (!found) continue;

    // Signature as well as name. An export's name is the class — `Auth` — while
    // the thing someone looks up is usually a member of it: `userOrNull`,
    // `salutation`, `assertInvalid`. Matching names alone answers "is there an
    // export called X", which is rarely the question; the question is "where is
    // this method and what does it take".
    const matched = parseSurface(await Bun.file(found.path).text()).filter(
      (entry) =>
        entry.name.toLowerCase().includes(filter) || entry.signature.toLowerCase().includes(filter),
    );
    if (matched.length > 0) hits.push({ package: found.scoped, entries: matched });
  }

  if (hits.length === 0) {
    return {
      text:
        `No export matching "${symbol}" in any installed package.\n\n` +
        `Searched: ${packages.join(", ")}`,
      data: { package: "", total: 0, matched: 0, entries: [] },
      failed: true,
    };
  }

  const total = hits.reduce((n, hit) => n + hit.entries.length, 0);
  const text = hits.map((hit) => render(hit.package, hit.entries, hit.entries.length)).join("\n\n");

  return {
    text: `${total} export(s) matching "${symbol}" across ${hits.length} package(s).\n\n${text}`,
    data: {
      package: hits.map((hit) => hit.package).join(", "),
      total,
      matched: total,
      entries: hits.flatMap((hit) => hit.entries),
    },
  };
}
