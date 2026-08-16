/**
 * The marker that separates a probe's answer from everything else on stdout.
 *
 * `bun zt arch:probe` boots the whole application, and a booted application
 * prints — dev banners, provider notices, a warning from a package that noticed
 * something. None of that is knowable in advance, so the reader does not try to
 * suppress it: the command emits this line, then one line of JSON, and the
 * reader takes the last occurrence and parses what follows.
 *
 * Shared by the writer and the reader so the two can never disagree, and long
 * and specific enough that no plausible log line collides with it.
 */
export const PROBE_SENTINEL = "<<<zerotal:arch:probe:json>>>";
