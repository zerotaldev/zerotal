/**
 * Reading and writing single `NAME=value` lines in `.env` content, for the commands that edit it.
 */

/** The value of `NAME=` in `.env` content, or `undefined` when the line is absent or empty. */
export function readEnvValue(content: string, name: string): string | undefined {
  const match = new RegExp(`^${name}=(.*)$`, "m").exec(content);
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}

/** Set `NAME=value` in `.env` content, replacing the line if there is one. */
export function setEnvValue(content: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const existing = new RegExp(`^${name}=.*$`, "m");
  if (existing.test(content)) return content.replace(existing, line);
  return content.replace(/\n*$/, "\n") + line + "\n";
}
