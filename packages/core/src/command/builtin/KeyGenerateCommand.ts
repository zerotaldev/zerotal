/**
 * The `key:generate` command and the helpers it uses to mint an APP_KEY and
 * write it into the project's `.env` file.
 */
import { Command } from "../Command.ts";

/** Generate a random 32-byte base64 application key. */
export function generateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

/** Return true if the given .env content already has an APP_KEY line. */
function hasAppKey(content: string): boolean {
  return content.includes("APP_KEY=");
}

/** Insert or replace the APP_KEY line in .env file content. */
export function updateEnvContent(content: string, key: string): string {
  return hasAppKey(content)
    ? content.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`)
    : content + `\nAPP_KEY=${key}\n`;
}

/**
 * `bun zt key:generate` — generates a new random APP_KEY and writes it to the
 * project's `.env` file.
 *
 * @category App setup
 */
export class KeyGenerateCommand extends Command {
  static commandName = "key:generate";
  static description = "Generate a new APP_KEY and write it to .env";
  static needsApp = false;

  static get args() {
    return [];
  }
  static get flags() {
    return [];
  }

  run(): Promise<void> {
    const key = generateKey();
    const envPath = ".env";

    return Bun.file(envPath)
      .text()
      .catch(() => "")
      .then((content) => {
        return Bun.write(envPath, updateEnvContent(content, key)).then(() => {
          this.info("APP_KEY generated and written to .env");
          this.dim(`  APP_KEY=${key}`);
        });
      });
  }
}
