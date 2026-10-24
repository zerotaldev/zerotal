/**
 * The `init:env` command: the one step between a fresh checkout and a bootable app.
 */
import { Command } from "../Command.ts";
import { generateKey } from "./KeyGenerateCommand.ts";
import { readEnvValue, setEnvValue } from "./envFile.ts";

/** The variables `.env.example` leaves for a key to be generated into. */
const GENERATED = ["APP_KEY", "SESSION_SECRET"];

/** Whether an `.env.example` value is an instruction rather than a value. */
function isPlaceholder(value: string | undefined): boolean {
  return value === undefined || value.includes("key:generate") || value.startsWith("change-me");
}

/**
 * Build `.env` from `.env.example`: copy it, and fill each secret the example leaves as a
 * placeholder with a freshly generated key.
 *
 * @returns The new content, and the variables that were filled in.
 */
export function envFromExample(example: string): { content: string; generated: string[] } {
  let content = example;
  const generated: string[] = [];
  for (const name of GENERATED) {
    if (!new RegExp(`^${name}=`, "m").test(content)) continue;
    if (!isPlaceholder(readEnvValue(content, name))) continue;
    content = setEnvValue(content, name, generateKey());
    generated.push(name);
  }
  return { content, generated };
}

/**
 * `bun zt init:env` — creates `.env` from `.env.example`, with the secrets generated.
 *
 * What you do on a server after cloning a repository, where `.env` is, rightly, not committed:
 * `cp .env.example .env`, then `key:generate`, then the same again for any other secret. A
 * checkout that has been through `bun install` runs this one command instead. It never touches
 * an existing `.env`; `key:generate` and `key:rotate` are for changing one.
 *
 * Run it after `bun install`: like every `zt` command it needs the framework installed. If you
 * are preparing `.env` before that, `openssl rand -base64 32` mints the same kind of key.
 *
 * @category App setup
 */
export class InitEnvCommand extends Command {
  static commandName = "init:env";
  static description = "Create .env from .env.example, with generated secrets";
  static needsApp = false;

  static get args() {
    return [];
  }
  static get flags() {
    return [];
  }

  async run(): Promise<void> {
    if (await Bun.file(".env").exists()) {
      this.info(".env already exists, so it was left alone.");
      this.dim(
        "  `bun zt key:generate` replaces its APP_KEY; `bun zt key:rotate` keeps the old one.",
      );
      return;
    }

    const example = await Bun.file(".env.example")
      .text()
      .catch(() => null);
    if (example === null) {
      this.error("There is no .env.example here to start from. Run this from the project root.");
      process.exitCode = 1;
      return;
    }

    const { content, generated } = envFromExample(example);
    await Bun.write(".env", content);

    this.info(".env created from .env.example.");
    if (generated.length > 0) this.dim(`  Generated: ${generated.join(", ")}`);
    this.dim("  Fill in the rest (DATABASE_URL, APP_URL, mail) before the first boot.");
  }
}
