/**
 * Write a package's prebuilt browser bundles into its `dist/`, together with the
 * index that lets a compiled app carry them.
 *
 * Shared by the `prepack` builds of the packages that serve scripts to the
 * browser (`packages/flow/scripts/build-client.ts`,
 * `packages/devtools/scripts/build-client.ts`). Each package builds its own
 * bundles — it knows its entries — and hands the code here, so the layout of
 * `dist/` and the shape of its index are decided in one place.
 *
 * The index, `dist/assets.js`, imports every bundle `with { type: "file" }` and
 * exports a map from bundle name to the path the import returns. That indirection
 * is the whole point: `bun build --compile` embeds a file it sees imported, and
 * the path then names the embedded copy, so `Bun.file(path)` reads it inside the
 * binary as it reads `dist/` on disk. A package loads the index with a literal
 * `import("../dist/assets.js" as string)`, which the bundler follows.
 *
 * @module
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The index file every package reads its bundles through. */
export const INDEX_FILE = "assets.js";

/** The text of `dist/assets.js` for these bundle names. */
export function indexSource(names: readonly string[]): string {
  const imports = names.map(
    (name, i) => `import bundle${i} from ${JSON.stringify(`./${name}.js`)} with { type: "file" };`,
  );
  const entries = names.map((name, i) => `  ${JSON.stringify(name)}: bundle${i},`);
  return [
    "// Generated when the package is packed. Do not edit, and do not commit.",
    "//",
    "// Each bundle is imported as a file so that `bun build --compile` embeds it; the",
    "// default export maps a bundle's name to the path it is read from, on disk or",
    "// inside a compiled binary.",
    ...imports,
    "",
    "export default {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

/**
 * Replace `distDir` with these bundles and their index.
 *
 * The directory is emptied first, so a bundle that a release stopped building
 * cannot linger in the next tarball.
 *
 * @param distDir - The package's `dist/` directory.
 * @param bundles - Bundle name → code. Each is written to `<name>.js`.
 * @returns The files written, relative to `distDir`.
 */
export function writeBrowserBundles(distDir: string, bundles: Record<string, string>): string[] {
  // Absolute, always: `rm("./dist")` resolves and deletes nothing on Windows.
  const dir = resolve(distDir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const names = Object.keys(bundles);
  const written: string[] = [];
  for (const name of names) {
    writeFileSync(join(dir, `${name}.js`), bundles[name]!);
    written.push(`${name}.js`);
  }
  writeFileSync(join(dir, INDEX_FILE), indexSource(names));
  written.push(INDEX_FILE);
  return written;
}
