import { PasswordBroker, Hash } from "zerotal/auth";
import { DB } from "zerotal/orm";
import { User } from "@app/models/User";
import { ResetPasswordNotification } from "@app/notifications/ResetPasswordNotification";

/**
 * Password-reset broker for the forgot/reset pages.
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
    // Nobody to send to is not an error the visitor hears about — the page says the
    // same thing either way (see app/routes/(guest)/forgot-password.ts).
    const user = await User.query().where("email", email).first();
    if (!user) return;

    // Through the mail driver in config/notifications.ts. Its default, "log", prints
    // the message and its link to the server output.
    await user.notify(new ResetPasswordNotification(token, email));
  },

  async resetPassword(email, newPassword) {
    const user = await User.query().where("email", email).first();
    if (!user) return;
    user.password = await Hash.make(newPassword);
    // Whoever reset the password proved they hold the inbox — the same thing the
    // verification link proves.
    if (!user.hasVerifiedEmail()) user.emailVerifiedAt = new Date();
    await user.save();
  },
});

/** The two calls the forgot/reset routes make, as booleans rather than result strings. */
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
