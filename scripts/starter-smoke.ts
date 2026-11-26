#!/usr/bin/env bun
/**
 * Scaffold every starter from the packed release and check it works, before anything
 * is published.
 *
 *   bun run scripts/publish-packages.ts --dry-run     # packs into .release-tarballs/
 *   bun run scripts/starter-smoke.ts                  # then this
 *
 * Unit tests run against the source tree, so they cannot see what a new user gets: the
 * tarballs `bun pm pack` writes, installed into a project `create-zerotal` just made.
 * The breakages that have reached users that way — a file a tarball left out, a
 * starter script that called something the package no longer had, generated agent
 * files that disagreed with the generator — all passed every unit test.
 *
 * So each starter is scaffolded with this checkout's `create-zerotal`, every Zerotal
 * dependency is pointed at its tarball (and overridden, so nothing comes from the
 * registry), and the app is installed and checked the way its own README says to:
 *
 *   - `bun zt test` passes;
 *   - `typecheck` and `format:check` pass, where the starter has them;
 *   - `zt arch:update --dry` has nothing to change (the shipped agent files are current);
 *   - `zt doctor` reports no failure (warnings, such as unrun migrations, are fine);
 *   - `zt list` exits rather than hanging.
 *
 * Run in the release workflow after the dry run, so a starter that does not work stops
 * the release before any package reaches npm.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEMPLATES } from "../packages/create-zerotal/src/args.ts";

const ROOT = join(import.meta.dir, "..");
const TARBALLS = join(ROOT, ".release-tarballs");
const CREATE = join(ROOT, "packages", "create-zerotal", "src", "index.ts");

/** One check's outcome. */
interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Package name for a tarball file, as `bun pm pack` names them. */
function packageOf(file: string): string | undefined {
  const match = /^(.*)-\d+\.\d+\.\d+(?:-[\w.]+)?\.tgz$/.exec(file);
  if (!match) return undefined;
  const base = match[1]!;
  if (base === "zerotal" || base === "create-zerotal") return base;
  return `@zerotal/${base.replace(/^zerotal-/, "")}`;
}

async function tarballMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const file of await readdir(TARBALLS)) {
    const name = packageOf(file);
    if (name && name !== "create-zerotal")
      map[name] = `file:${join(TARBALLS, file).replace(/\\/g, "/")}`;
  }
  if (Object.keys(map).length === 0) {
    throw new Error(`No tarballs in ${TARBALLS}. Run the publish dry run first.`);
  }
  return map;
}

/**
 * The environment an app is run with: this process's, minus anything an app reads.
 *
 * A new user's app runs on its own `.env`. The release job sets `APP_KEY` and
 * `APP_ENV` for its own tests, and Bun lets a variable already set win over `.env`,
 * so passing them through tested a different app from the one a user gets — and an
 * empty one broke config loading outright.
 */
function appEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value === undefined) continue;
    if (/^(APP_|DATABASE_|ZT_|SESSION_|MAIL_|SMTP_|REDIS_|NODE_ENV$)/.test(key)) continue;
    out[key] = value;
  }
  out["NO_COLOR"] = "1";
  return out;
}

/** Colour codes, which some output carries despite `NO_COLOR`. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Run a command in `cwd`; resolve to its exit code and combined output, uncoloured. */
async function run(
  cmd: string[],
  cwd: string,
  timeoutMs = 300_000,
): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: appEnv() });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, out: (out + err).replace(ANSI, "") };
}

function tail(text: string, lines = 15): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

async function smoke(template: string, tarballs: Record<string, string>): Promise<Check[]> {
  const dir = await mkdtemp(join(tmpdir(), `zt-smoke-${template}-`));
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) =>
    checks.push({ name, ok, ...(ok || detail === undefined ? {} : { detail }) });

  try {
    const scaffold = await run(
      [process.execPath, CREATE, "app", `--template=${template}`, "--yes", "--no-install"],
      dir,
    );
    check("scaffold", scaffold.code === 0, tail(scaffold.out));
    if (scaffold.code !== 0) return checks;

    const app = join(dir, "app");
    const manifestPath = join(app, "package.json");
    const manifest = (await Bun.file(manifestPath).json()) as Record<
      string,
      Record<string, string>
    >;
    for (const field of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (tarballs[name]) manifest[field]![name] = tarballs[name]!;
      }
    }
    manifest["overrides"] = tarballs;
    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const install = await run([process.execPath, "install"], app);
    check("install", install.code === 0, tail(install.out));
    if (install.code !== 0) return checks;

    const scripts = (manifest["scripts"] ?? {}) as Record<string, string>;
    const zt = (...args: string[]) => run([process.execPath, "zt.ts", ...args], app);

    const test = await zt("test");
    check("zt test", test.code === 0, tail(test.out));

    for (const script of ["typecheck", "format:check"]) {
      if (!scripts[script]) continue;
      const result = await run([process.execPath, "run", script], app);
      check(script, result.code === 0, tail(result.out));
    }

    const arch = await zt("arch:update", "--dry");
    check(
      "arch:update has nothing to change",
      arch.code === 0 && /\b0 file\(s\) would change/.test(arch.out),
      tail(arch.out),
    );

    const doctor = await zt("doctor");
    check("doctor has no failure", doctor.code === 0, tail(doctor.out, 30));

    const list = await run([process.execPath, "zt.ts", "list"], app, 30_000);
    check("zt list exits", list.code === 0, tail(list.out));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return checks;
}

const tarballs = await tarballMap();
const only = process.argv.slice(2);
const templates = only.length > 0 ? TEMPLATES.filter((t) => only.includes(t)) : [...TEMPLATES];

let failed = 0;
for (const template of templates) {
  const started = Date.now();
  const checks = await smoke(template, tarballs);
  const bad = checks.filter((c) => !c.ok);
  failed += bad.length;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `${bad.length === 0 ? "✓" : "✗"} ${template} (${seconds}s): ${checks.map((c) => `${c.ok ? "" : "✗ "}${c.name}`).join(", ")}`,
  );
  for (const c of bad) console.log(`\n  ── ${template}: ${c.name} ──\n${c.detail ?? ""}\n`);
}

if (failed > 0) {
  console.error(
    `\n${failed} starter check(s) failed. Nothing should be published until they pass.`,
  );
  process.exit(1);
}
console.log(
  `\nstarters:smoke — all ${templates.length} starters install from the packed release and pass.`,
);
