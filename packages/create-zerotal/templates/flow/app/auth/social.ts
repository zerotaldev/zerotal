import { NotFoundError, type HttpContext } from "zerotal";
import { Auth, Hash, Social, type SocialUser } from "zerotal/auth";
import { DB } from "zerotal/orm";
import { User } from "@app/models/User";

/**
 * Sign in with GitHub or Google.
 *
 * Which providers are on is decided by config/social.ts — each is listed once its
 * client id is in .env. The sign-in page shows a button for exactly those.
 */

/** The providers this app offers, in the order the buttons appear. */
export function socialProviders(): string[] {
  // SocialProvider registered a driver for each provider config/social.ts lists.
  const registered = Social.drivers();
  return ["github", "google"].filter((name) => registered.includes(name));
}

/** The `:provider` of this request, when it is one this app has switched on — else a 404. */
export function enabledProvider(http: HttpContext): string {
  const name = String(http.params["provider"] ?? "");
  if (!socialProviders().includes(name)) throw new NotFoundError();
  return name;
}

/** What became of a sign-in attempt. */
export type SocialSignIn =
  | { status: "signed-in"; user: User }
  | { status: "needs-password"; email: string }
  | { status: "no-email" };

/**
 * Find or create the user behind a provider's account, and sign them in.
 *
 * - An account already linked to this GitHub/Google identity signs in.
 * - Otherwise, an existing user with the same email is linked and signed in — but only
 *   when *both* sides have verified that address. An account registered with someone
 *   else's address must not be claimable by whoever holds it on GitHub, nor an account
 *   claimed through an address the provider never checked. They sign in with their
 *   password instead.
 * - Otherwise a new user is created, verified if the provider verified the address. Its
 *   password is random; "Forgot your password?" sets one.
 */
export async function signInWithProvider(
  provider: string,
  profile: SocialUser,
): Promise<SocialSignIn> {
  const linked = (await DB.table("social_accounts")
    .where("provider", provider)
    .where("provider_id", profile.id)
    .first()) as { user_id: number } | null;

  let user = linked ? await User.find(Number(linked.user_id)) : null;

  if (!user) {
    if (!profile.email) return { status: "no-email" };
    const existing = await User.query().where("email", profile.email).first();

    if (existing && !(existing.hasVerifiedEmail() && profile.emailVerified)) {
      return { status: "needs-password", email: profile.email };
    }

    user = existing ?? (await createUser(profile, profile.email));
    const now = new Date().toISOString();
    await DB.table("social_accounts").insert({
      user_id: user.id,
      provider,
      provider_id: profile.id,
      created_at: now,
      updated_at: now,
    });
  }

  await Auth.login(user);
  return { status: "signed-in", user };
}

async function createUser(profile: SocialUser, email: string): Promise<User> {
  const user = new User();
  user.name = profile.name || email.split("@")[0] || email;
  user.email = email;
  // Unusable until reset: nobody knows it.
  user.password = await Hash.make(crypto.randomUUID() + crypto.randomUUID());
  user.role = "user";
  user.emailVerifiedAt = profile.emailVerified ? new Date() : null;
  await user.save();
  return user;
}
