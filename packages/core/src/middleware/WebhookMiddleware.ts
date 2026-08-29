/**
 * Webhook signature-verification middleware: rejects requests whose HMAC
 * signature is missing, expired, or invalid before they reach a controller.
 * Ships GitHub and Stripe presets and seeds the parsed body for downstream use.
 */
import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { BaseMiddleware, deepMerge } from "./BaseMiddleware.ts";
import { rescueSync } from "../helpers/index.ts";
import { safeEqual } from "../support/crypto.ts";

export interface WebhookOptions {
  /** HMAC secret used to verify the signature. */
  secret: string;
  /** Request header that carries the signature. Default: 'x-webhook-signature'. */
  header?: string | undefined;
  /** HMAC algorithm. Default: 'sha256'. */
  algorithm?: "sha256" | "sha1" | "sha512" | undefined;
  /**
   * Expected signature prefix that will be stripped before comparison
   * (e.g. `'sha256='` for GitHub). Default: `''`.
   */
  prefix?: string | undefined;
  /**
   * Max age in seconds for replay-attack protection.
   * Requires `timestampHeader` (or `format: 'stripe'`). Disabled when `undefined`.
   */
  tolerance?: number | undefined;
  /**
   * Header that carries the Unix timestamp of the request.
   * When present the signed payload becomes `{timestamp}{timestampSeparator}{body}`.
   */
  timestampHeader?: string | undefined;
  /** Separator between timestamp and body in the signed payload. Default: `'.'`. */
  timestampSeparator?: string | undefined;
  /**
   * Header format.
   * - `'raw'` (default) — signature is the full (or prefix-stripped) header value.
   * - `'stripe'` — header is parsed as `t=<ts>,v1=<sig>` (Stripe-Signature style).
   */
  format?: "raw" | "stripe" | undefined;
}

/**
 * Verifies HMAC webhook signatures before allowing the request to proceed.
 *
 * Responds with `401 Unauthorized` when the signature is missing, expired, or invalid.
 * The raw body is read once and the parsed JSON is seeded into the body cache so
 * downstream controllers can still call `await ctx.body()` normally.
 *
 * @example
 * // Generic
 * app.use([WebhookMiddleware.with({ secret: env('WEBHOOK_SECRET') })]);
 *
 * // GitHub
 * Router.post('/webhooks/github', GithubController, 'handle', [
 *   WebhookMiddleware.github(env('GITHUB_WEBHOOK_SECRET')),
 * ]);
 *
 * // Stripe
 * Router.post('/webhooks/stripe', StripeController, 'handle', [
 *   WebhookMiddleware.stripe(env('STRIPE_WEBHOOK_SECRET')),
 * ]);
 */
export class WebhookMiddleware extends BaseMiddleware<WebhookOptions> {
  protected options: WebhookOptions = {
    secret: "",
    header: "x-webhook-signature",
    algorithm: "sha256",
    prefix: "",
    timestampSeparator: ".",
    format: "raw",
  };

  constructor(options: Partial<WebhookOptions> = {}) {
    super();
    this.options = deepMerge(this.options, options);
  }

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const options = this.options;

    // Read the raw body exactly once; the stream is consumed after this.
    const rawBody = await http.request.text();

    // Seed the body cache so http.body() / http.input() work downstream.
    http._primeBody(_tryParseJson(rawBody));

    let signature: string;
    let payload: string;

    if (options.format === "stripe") {
      const parsed = _parseStripeHeader(http.header(options.header ?? "stripe-signature") ?? "");
      if (!parsed) {
        return new Response("Missing or malformed webhook signature", { status: 401 });
      }
      if (options.tolerance !== undefined) {
        const age = Math.abs(Date.now() / 1000 - parsed.timestamp);
        if (age > options.tolerance) {
          return new Response("Webhook timestamp expired", { status: 401 });
        }
      }
      signature = parsed.signature;
      payload = `${parsed.timestamp}.${rawBody}`;
    } else {
      const signatureHeader = http.header(options.header!);
      if (!signatureHeader) {
        return new Response("Missing webhook signature", { status: 401 });
      }

      const prefix = options.prefix ?? "";
      signature = signatureHeader.startsWith(prefix)
        ? signatureHeader.slice(prefix.length)
        : signatureHeader;

      if (options.timestampHeader) {
        const timestamp = http.header(options.timestampHeader);
        if (!timestamp) {
          return new Response("Missing webhook timestamp", { status: 401 });
        }
        if (options.tolerance !== undefined) {
          const timestampSeconds = parseInt(timestamp, 10);
          if (
            isNaN(timestampSeconds) ||
            Math.abs(Date.now() / 1000 - timestampSeconds) > options.tolerance
          ) {
            return new Response("Webhook timestamp expired", { status: 401 });
          }
        }
        payload = `${timestamp}${options.timestampSeparator ?? "."}${rawBody}`;
      } else {
        payload = rawBody;
      }
    }

    // Bun.CryptoHasher computes an HMAC when constructed with a key.
    const expected = new Bun.CryptoHasher(options.algorithm ?? "sha256", options.secret)
      .update(payload)
      .digest("hex");

    if (!_timingSafeHexCompare(signature, expected)) {
      return new Response("Invalid webhook signature", { status: 401 });
    }

    return next();
  }

  /** GitHub webhook preset: `X-Hub-Signature-256` header, `sha256=` prefix. */
  static github(secret: string): WebhookMiddleware {
    return new WebhookMiddleware({
      secret,
      header: "x-hub-signature-256",
      algorithm: "sha256",
      prefix: "sha256=",
    });
  }

  /**
   * Stripe webhook preset: `Stripe-Signature` header with `t=<ts>,v1=<sig>` format,
   * 5-minute replay-attack tolerance.
   */
  static stripe(secret: string, toleranceSeconds = 300): WebhookMiddleware {
    return new WebhookMiddleware({
      secret,
      header: "stripe-signature",
      algorithm: "sha256",
      format: "stripe",
      tolerance: toleranceSeconds,
    });
  }
}

// ── Internals ────────────────────────────────────────────────────────────────

function _parseStripeHeader(header: string): { timestamp: number; signature: string } | null {
  let timestamp: number | undefined;
  let signature: string | undefined;

  for (const part of header.split(",")) {
    const equalsIndex = part.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = part.slice(0, equalsIndex).trim();
    const value = part.slice(equalsIndex + 1).trim();
    if (key === "t") timestamp = parseInt(value, 10);
    if (key === "v1") signature = value;
  }

  if (timestamp === undefined || isNaN(timestamp) || !signature) return null;
  return { timestamp, signature };
}

/**
 * Constant-time comparison of two hex digests via the shared {@link safeEqual}.
 * Case-insensitive (like the byte-decoding compare it replaced) — `expected`
 * is always the lowercase output of `.digest("hex")`.
 */
function _timingSafeHexCompare(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  return safeEqual(actual.toLowerCase(), expected.toLowerCase());
}

function _tryParseJson(raw: string): Record<string, unknown> {
  return rescueSync(() => JSON.parse(raw) as Record<string, unknown>, {});
}
