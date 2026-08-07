import { describe, it, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { WebhookMiddleware } from "./WebhookMiddleware.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import type { NextFn } from "../pipeline/types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = "super-secret-key";

function sign(secret: string, payload: string, algorithm = "sha256"): string {
  return createHmac(algorithm, secret).update(payload).digest("hex");
}

function makeCtx(body: string, headers: Record<string, string> = {}, method = "POST"): HttpContext {
  return HttpContext.fake("http://localhost/webhook", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

// Pure pass-through downstream: produces no response.
const passNext: NextFn = async () => undefined;

// Drives the middleware like the pipeline runner: a Response returned by
// handle() is mirrored onto the canonical ctx.response, so assertions on
// ctx.response see the short-circuit response.
async function run(
  mw: WebhookMiddleware,
  ctx: HttpContext,
  next: NextFn = passNext,
): Promise<void> {
  const result = await mw.handle(ctx, next);
  if (result instanceof Response) ctx.response = result;
}

// ── Generic / raw format ──────────────────────────────────────────────────────

describe("WebhookMiddleware (raw format)", () => {
  it("passes a valid signature", async () => {
    const body = JSON.stringify({ event: "ping" });
    const sig = sign(SECRET, body);
    const mw = new WebhookMiddleware({ secret: SECRET });
    const ctx = makeCtx(body, { "x-webhook-signature": sig });

    await run(mw, ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("rejects when signature header is absent", async () => {
    const mw = new WebhookMiddleware({ secret: SECRET });
    const ctx = makeCtx("{}");

    await run(mw, ctx);
    expect(ctx.response!.status).toBe(401);
    expect(await ctx.response!.text()).toContain("Missing webhook signature");
  });

  it("rejects an invalid signature", async () => {
    const body = JSON.stringify({ event: "ping" });
    const mw = new WebhookMiddleware({ secret: SECRET });
    const ctx = makeCtx(body, { "x-webhook-signature": "deadbeef00" });

    await run(mw, ctx);
    expect(ctx.response!.status).toBe(401);
    expect(await ctx.response!.text()).toContain("Invalid webhook signature");
  });

  it("strips the configured prefix before comparing", async () => {
    const body = JSON.stringify({ event: "push" });
    const sig = `sha256=${sign(SECRET, body)}`;
    const mw = new WebhookMiddleware({ secret: SECRET, prefix: "sha256=" });
    const ctx = makeCtx(body, { "x-webhook-signature": sig });

    await run(mw, ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("supports sha1 algorithm", async () => {
    const body = JSON.stringify({ event: "push" });
    const sig = sign(SECRET, body, "sha1");
    const mw = new WebhookMiddleware({ secret: SECRET, algorithm: "sha1" });
    const ctx = makeCtx(body, { "x-webhook-signature": sig });

    await run(mw, ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("uses a custom header name", async () => {
    const body = JSON.stringify({ x: 1 });
    const sig = sign(SECRET, body);
    const mw = new WebhookMiddleware({ secret: SECRET, header: "x-my-sig" });
    const ctx = makeCtx(body, { "x-my-sig": sig });

    await run(mw, ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("seeds the body cache so ctx.body() works downstream", async () => {
    const payload = { event: "order.created", id: 42 };
    const body = JSON.stringify(payload);
    const sig = sign(SECRET, body);
    const mw = new WebhookMiddleware({ secret: SECRET });
    const ctx = makeCtx(body, { "x-webhook-signature": sig });

    let seenBody: Record<string, unknown> = {};
    const capturingNext: NextFn = async () => {
      seenBody = await ctx.body();
      return undefined;
    };

    await run(mw, ctx, capturingNext);
    expect(seenBody["event"]).toBe("order.created");
    expect(seenBody["id"]).toBe(42);
  });
});

// ── Timestamp + replay protection ─────────────────────────────────────────────

describe("WebhookMiddleware with timestampHeader + tolerance", () => {
  it("passes when timestamp is fresh", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "{}";
    const sig = sign(SECRET, `${ts}.${body}`);
    const mw = new WebhookMiddleware({
      secret: SECRET,
      timestampHeader: "x-webhook-ts",
      tolerance: 300,
    });
    const ctx = makeCtx(body, { "x-webhook-signature": sig, "x-webhook-ts": ts });

    await run(mw, ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("rejects when timestamp is expired", async () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 600); // 10 min ago
    const body = "{}";
    const sig = sign(SECRET, `${staleTs}.${body}`);
    const mw = new WebhookMiddleware({
      secret: SECRET,
      timestampHeader: "x-webhook-ts",
      tolerance: 300,
    });
    const ctx = makeCtx(body, { "x-webhook-signature": sig, "x-webhook-ts": staleTs });

    await run(mw, ctx);
    expect(ctx.response!.status).toBe(401);
    expect(await ctx.response!.text()).toContain("expired");
  });

  it("rejects when timestamp header is missing", async () => {
    const body = "{}";
    const mw = new WebhookMiddleware({
      secret: SECRET,
      timestampHeader: "x-webhook-ts",
    });
    const sig = sign(SECRET, body);
    const ctx = makeCtx(body, { "x-webhook-signature": sig });

    await run(mw, ctx);
    expect(ctx.response!.status).toBe(401);
    expect(await ctx.response!.text()).toContain("Missing webhook timestamp");
  });

  it("uses a custom timestampSeparator", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "{}";
    const payload = `${ts}|${body}`;
    const sig = sign(SECRET, payload);
    const mw = new WebhookMiddleware({
      secret: SECRET,
      timestampHeader: "x-ts",
      timestampSeparator: "|",
    });
    const ctx = makeCtx(body, { "x-webhook-signature": sig, "x-ts": ts });

    await run(mw, ctx);
    expect(ctx.response).toBeUndefined();
  });
});

// ── GitHub preset ─────────────────────────────────────────────────────────────

describe("WebhookMiddleware.github()", () => {
  it("passes a valid GitHub signature", async () => {
    const body = JSON.stringify({ ref: "refs/heads/main" });
    const sig = `sha256=${sign(SECRET, body)}`;
    const ctx = makeCtx(body, { "x-hub-signature-256": sig });

    await run(WebhookMiddleware.github(SECRET), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("rejects a missing X-Hub-Signature-256 header", async () => {
    const ctx = makeCtx("{}");
    await run(WebhookMiddleware.github(SECRET), ctx);
    expect(ctx.response!.status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    const original = JSON.stringify({ action: "opened" });
    const tampered = JSON.stringify({ action: "closed" });
    const sig = `sha256=${sign(SECRET, original)}`;
    const ctx = makeCtx(tampered, { "x-hub-signature-256": sig });

    await run(WebhookMiddleware.github(SECRET), ctx);
    expect(ctx.response!.status).toBe(401);
  });
});

// ── Stripe preset ─────────────────────────────────────────────────────────────

describe("WebhookMiddleware.stripe()", () => {
  it("passes a valid Stripe signature", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ type: "payment_intent.succeeded" });
    const sig = sign(SECRET, `${ts}.${body}`);
    const hdr = `t=${ts},v1=${sig}`;
    const ctx = makeCtx(body, { "stripe-signature": hdr });

    await run(WebhookMiddleware.stripe(SECRET), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("rejects a missing Stripe-Signature header", async () => {
    const ctx = makeCtx("{}");
    await run(WebhookMiddleware.stripe(SECRET), ctx);
    expect(ctx.response!.status).toBe(401);
    expect(await ctx.response!.text()).toContain("malformed");
  });

  it("rejects a malformed Stripe-Signature header", async () => {
    const ctx = makeCtx("{}", { "stripe-signature": "garbage" });
    await run(WebhookMiddleware.stripe(SECRET), ctx);
    expect(ctx.response!.status).toBe(401);
  });

  it("rejects an expired timestamp", async () => {
    const staleTs = Math.floor(Date.now() / 1000) - 400; // outside 300s window
    const body = JSON.stringify({ type: "charge.failed" });
    const sig = sign(SECRET, `${staleTs}.${body}`);
    const hdr = `t=${staleTs},v1=${sig}`;
    const ctx = makeCtx(body, { "stripe-signature": hdr });

    await run(WebhookMiddleware.stripe(SECRET), ctx);
    expect(ctx.response!.status).toBe(401);
    expect(await ctx.response!.text()).toContain("expired");
  });

  it("accepts a custom tolerance window", async () => {
    const ts = Math.floor(Date.now() / 1000) - 50;
    const body = "{}";
    const sig = sign(SECRET, `${ts}.${body}`);
    const hdr = `t=${ts},v1=${sig}`;
    const ctx = makeCtx(body, { "stripe-signature": hdr });

    await run(WebhookMiddleware.stripe(SECRET, 60), ctx);
    expect(ctx.response).toBeUndefined();
  });

  it("rejects an invalid signature even with a fresh timestamp", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const hdr = `t=${ts},v1=badhex`;
    const ctx = makeCtx("{}", { "stripe-signature": hdr });

    await run(WebhookMiddleware.stripe(SECRET), ctx);
    expect(ctx.response!.status).toBe(401);
  });
});
