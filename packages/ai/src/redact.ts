/**
 * Prompt redaction for the observability path.
 *
 * A prompt is user data. It is also the single most useful thing to put on a
 * monitor row, which is exactly the tension: the debugging value is real, and
 * so is the fact that logs outlive the request and get shipped somewhere else.
 *
 * The compromise is a *preview*, not the prompt: length and shape survive, the
 * content does not. With redaction off you get a truncated prompt instead —
 * still truncated, because a 40 KB system prompt on every monitor row is its
 * own problem.
 */

/** Characters of prompt kept when redaction is off. */
const PREVIEW_LIMIT = 200;

/**
 * Turn a prompt into something safe to record.
 *
 * @param prompt - The raw prompt text.
 * @param redact - When true (the default from config), emit shape only.
 *
 * @example
 * redactPrompt("Reset the password for ada@example.com", true);
 * // → "[redacted 38 chars]"
 * redactPrompt("Reset the password for ada@example.com", false);
 * // → "Reset the password for ada@example.com"
 */
export function redactPrompt(prompt: string, redact: boolean): string {
  if (redact) return `[redacted ${prompt.length} chars]`;
  return prompt.length > PREVIEW_LIMIT ? `${prompt.slice(0, PREVIEW_LIMIT)}…` : prompt;
}
