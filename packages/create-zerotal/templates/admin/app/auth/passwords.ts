import { PasswordBroker, Hash } from "zerotal/auth";
import { DB } from "zerotal/orm";
import { Log } from "zerotal/logger";
import { User } from "@app/models/User";

/**
 * Password-reset broker for the panel's forgot/reset screens.
 *
 * The broker owns the security-sensitive half — generating the token, hashing
 * it before storage, expiring it, and comparing candidates in constant time.
 * Everything below is the part only this app can answer: where tokens live, how
 * a message reaches the user, and what "set the password" means for our model.
 */
const broker = new PasswordBroker({
  expireMinutes: 60,

  async findToken(email) {
    const row = await DB.table("password_reset_tokens").where("email", email).first();
    if (!row) return null;
    return {
      token: String((row as Record<string, unknown>)["token"]),
      createdAt: new Date(String((row as Record<string, unknown>)["created_at"])),
    };
  },

  async storeToken(email, hash) {
    // One live token per address: a second request invalidates the first rather
    // than leaving two working links in someone's inbox.
    await DB.table("password_reset_tokens").where("email", email).delete();
    await DB.table("password_reset_tokens").insert({
      email,
      token: hash,
      created_at: new Date().toISOString(),
    });
  },

  async deleteToken(email) {
    await DB.table("password_reset_tokens").where("email", email).delete();
  },

  async pruneTokens(cutoff) {
    await DB.table("password_reset_tokens").where("created_at", "<", cutoff.toISOString()).delete();
  },

  async sendResetLink(email, token) {
    const url = `${process.env["APP_URL"] ?? "http://localhost:3000"}/admin/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    // Logged rather than emailed, so a freshly scaffolded app has a working
    // reset flow before any mail server exists. To send it for real, add
    // `@zerotal/notifications` and swap this line for a Mail send — the token
    // is the only thing this callback needs to deliver.
    Log.info(`[password reset] ${email} → ${url}`);
  },

  async resetPassword(email, newPassword) {
    const user = await User.query().where("email", email).first();
    if (!user) return;
    user.password = await Hash.make(newPassword);
    await user.save();
  },
});

/**
 * Adapter matching the panel's `passwordReset` contract, which wants booleans
 * rather than the broker's result strings.
 */
export const passwordReset = {
  async sendResetLink(email: string): Promise<boolean> {
    // Always reports success. Answering "no such account" here would turn the
    // forgot-password form into a way to test which addresses are registered.
    await broker.sendResetLink(email);
    return true;
  },

  async reset(input: { email: string; token: string; password: string }): Promise<boolean> {
    const result = await broker.reset(input.token, input.email, input.password);
    return result === "passwords.reset";
  },
};
