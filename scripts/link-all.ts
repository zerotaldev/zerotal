// Register (or unregister) every publishable Zerotal package with `bun link`
// so external projects can `bun link @zerotal/<name>` against local source.
//
//   bun run scripts/link-all.ts            # register all packages
//   bun run scripts/link-all.ts --unlink   # unregister all packages
//
// Inside this monorepo you do NOT need this — packages resolve via workspace:*.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PKGS = join(ROOT, "packages");
const unlink = process.argv.includes("--unlink");
const cmd = unlink ? "unlink" : "link";

const names: string[] = [];
for (const dir of readdirSync(PKGS)) {
  const pkgPath = join(PKGS, dir, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = require(pkgPath);
  if (pkg.private === true || !pkg.name) continue; // publishable only

  const proc = Bun.spawnSync(["bun", cmd], {
    cwd: join(PKGS, dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode === 0) {
    names.push(pkg.name);
  } else {
    console.error(`✗ ${pkg.name}: ${proc.stderr.toString().trim()}`);
  }
}

console.log(`${unlink ? "Unregistered" : "Registered"} ${names.length} packages:`);
console.log(names.sort().join("\n"));
if (!unlink) {
  console.log(
    `\nIn your external app, link the ones you use, e.g.:\n  bun link @zerotal/core @zerotal/flow @zerotal/orm`,
  );
}
