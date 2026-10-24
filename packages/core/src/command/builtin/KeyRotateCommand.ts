/**
 * The `key:rotate` command and the `.env` editing it needs.
 */
import { Command } from "../Command.ts";
import { generateKey } from "./KeyGenerateCommand.ts";
import { readEnvValue, setEnvValue } from "./envFile.ts";

/**
 * Rotate `APP_KEY` in `.env` content: the current key becomes the newest entry of
 * `APP_PREVIOUS_KEYS` and a fresh one takes its place.
 *
 * @returns The new content and both keys, or `null` when there is no `APP_KEY` to rotate.
 */
export function rotateEnvContent(
  content: string,
): { content: string; retired: string; created: string } | null {
  const retired = readEnvValue(content, "APP_KEY");
  if (!retired) return null;

  const created = generateKey();
  const earlier = (readEnvValue(content, "APP_PREVIOUS_KEYS") ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0 && key !== retired);

  let next = setEnvValue(content, "APP_KEY", created);
  next = setEnvValue(next, "APP_PREVIOUS_KEYS", [retired, ...earlier].join(","));
  return { content: next, retired, created };
}

/**
 * `bun zt key:rotate` — replaces `APP_KEY` and keeps the old one as a previous key, so what was
 * encrypted with it still decrypts.
 *
 * Replacing `APP_KEY` outright, the right response to a leak, makes every encrypted value
 * unreadable at once, and an app with a hundred encrypted columns has no way to recover but to
 * have each one entered again. With the old key kept in `APP_PREVIOUS_KEYS`, `Crypt` still reads
 * old values and encrypts new ones under the new key; `Crypt.reencrypt()` moves the rest across
 * at your pace, and `key:rotate --forget` drops the old keys when nothing uses them.
 *
 * Values signed rather than encrypted (signed URLs, Flow snapshots, JWTs) are not carried over:
 * those in flight when the new key is deployed stop validating, and are short-lived.
 *
 * @category App setup
 */
export class KeyRotateCommand extends Command {
  static commandName = "key:rotate";
  static description = "Replace APP_KEY, keeping the old one to decrypt existing values";
  static needsApp = false;

  static get args() {
    return [];
  }
  static get flags() {
    return [
      {
        name: "forget",
        type: "boolean" as const,
        description: "Drop APP_PREVIOUS_KEYS, once nothing is encrypted under an old key",
        default: false,
      },
    ];
  }

  async run(): Promise<void> {
    const envPath = ".env";
    const content = await Bun.file(envPath)
      .text()
      .catch(() => null);

    if (content === null) {
      this.error("No .env file here. Run this from the project root.");
      process.exitCode = 1;
      return;
    }

    if (this.flags["forget"]) {
      if (!readEnvValue(content, "APP_PREVIOUS_KEYS")) {
        this.info("APP_PREVIOUS_KEYS is already empty.");
        return;
      }
      await Bun.write(envPath, setEnvValue(content, "APP_PREVIOUS_KEYS", ""));
      this.info(
        "APP_PREVIOUS_KEYS cleared. Anything still encrypted under an old key is now unreadable.",
      );
      return;
    }

    const rotated = rotateEnvContent(content);
    if (!rotated) {
      this.error("There is no APP_KEY in .env to rotate. Run `bun zt key:generate` first.");
      process.exitCode = 1;
      return;
    }

    await Bun.write(envPath, rotated.content);
    this.info("APP_KEY rotated; the old key is kept in APP_PREVIOUS_KEYS.");
    this.dim("  1. Deploy the new .env. Old values keep decrypting; new ones use the new key.");
    this.dim(
      "  2. Re-encrypt what you store with Crypt.reencrypt(), for example in a command or a job.",
    );
    this.dim("  3. Run `bun zt key:rotate --forget` when nothing is under an old key.");
    this.dim("  Signed URLs and Flow snapshots issued under the old key stop validating.");
  }
}
