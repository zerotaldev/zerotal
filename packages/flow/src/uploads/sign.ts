// HMAC signing for upload references — same APP_KEY scheme as snapshot signing
// (see dehydrate.ts), so temp-file tokens are consistent and tamper-proof.
import { safeEqual, hmacHex } from "@zerotal/core";

function appKey(): string {
  const key = Bun.env["APP_KEY"];
  if (!key) throw new Error("[Flow] APP_KEY is not set. Upload signing requires APP_KEY.");
  return key;
}

export function sign(payload: string): string {
  return hmacHex(payload, appKey());
}

export function verify(payload: string, sig: string): boolean {
  // Constant-time comparison (digest length is a fixed public constant).
  return safeEqual(sign(payload), sig);
}
