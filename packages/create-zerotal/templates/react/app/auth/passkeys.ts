import { config, env } from "zerotal";
import { PasskeyService, type PasskeyCredential, type PasskeyTransport } from "zerotal/auth";
import { DB } from "zerotal/orm";

/**
 * Passkeys: sign in with Touch ID, Windows Hello, a phone or a security key instead of
 * a password.
 *
 * Off until PASSKEY_RP_ID is set in .env. The "relying party id" is the domain the
 * passkeys are bound to — `localhost` in development, your domain in production — and a
 * passkey made for one domain never works on another, so pick it once.
 *
 * The WebAuthn library (`@simplewebauthn/server`, with `reflect-metadata`) is loaded on
 * the first ceremony, not at boot, so an app with passkeys off never loads it.
 */
export function passkeysEnabled(): boolean {
  return env("PASSKEY_RP_ID", "") !== "";
}

/** Session keys holding the challenge between "options" and "verify". */
export const REGISTRATION_CHALLENGE_KEY = "passkey_registration_challenge";
export const LOGIN_CHALLENGE_KEY = "passkey_login_challenge";

interface PasskeyRow {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  device_type: string;
  backed_up: number | boolean;
  transports: string | null;
  name: string | null;
  last_used_at: string | null;
  created_at: string;
}

function toCredential(row: PasskeyRow): PasskeyCredential {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    credential_id: row.credential_id,
    public_key: row.public_key,
    counter: Number(row.counter),
    device_type: row.device_type === "multiDevice" ? "multiDevice" : "singleDevice",
    backed_up: Boolean(row.backed_up),
    transports: row.transports ? (JSON.parse(row.transports) as PasskeyTransport[]) : null,
    name: row.name,
  };
}

let service: PasskeyService | undefined;

/** The configured service. Built on first use, so config is read once the app has booted. */
export function passkeys(): PasskeyService {
  service ??= new PasskeyService({
    rpName: config("app.name"),
    rpId: env("PASSKEY_RP_ID", "localhost"),
    origin: env("PASSKEY_ORIGIN", config("app.url")),

    async findUserCredentials(userId) {
      const rows = await DB.table("passkeys").where("user_id", userId).get<PasskeyRow>();
      return rows.map(toCredential);
    },

    async findCredential(credentialId) {
      const row = await DB.table("passkeys")
        .where("credential_id", credentialId)
        .first<PasskeyRow>();
      return row ? toCredential(row) : null;
    },

    async saveCredential(credential) {
      const now = new Date().toISOString();
      await DB.table("passkeys").insert({
        ...credential,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
        created_at: now,
        updated_at: now,
      });
    },

    async updateCounter(id, counter) {
      await DB.table("passkeys")
        .where("id", id)
        .update({ counter, last_used_at: new Date().toISOString() });
    },
  });
  return service;
}

/** What Settings → Passkeys lists. */
export interface PasskeySummary {
  id: number;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listPasskeys(userId: number): Promise<PasskeySummary[]> {
  const rows = await DB.table("passkeys")
    .where("user_id", userId)
    .orderBy("created_at", "desc")
    .get<PasskeyRow>();
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name ?? "Passkey",
    deviceType: row.device_type,
    backedUp: Boolean(row.backed_up),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

/** Remove one of the user's passkeys. False when it is not theirs, or does not exist. */
export async function deletePasskey(userId: number, id: number): Promise<boolean> {
  const row = await DB.table("passkeys").where("id", id).where("user_id", userId).first();
  if (!row) return false;
  await DB.table("passkeys").where("id", id).delete();
  return true;
}
