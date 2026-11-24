import { Factory } from "zerotal/testing";
import { User } from "../../app/models/User.ts";

/** The password every factory user has, so a test can sign in as one. */
export const FACTORY_PASSWORD = "password";

// Hashed once rather than per user: argon2id is slow on purpose, and a test that makes
// twenty users should not pay for it twenty times.
const HASHED = Bun.password.hashSync(FACTORY_PASSWORD, { algorithm: "argon2id" });

/**
 * A verified user with the password "password".
 *
 *   await UserFactory.create();                              // verified
 *   await UserFactory.create({ emailVerifiedAt: null });     // still to verify
 */
export const UserFactory = Factory.define(User, (fake) => ({
  name: fake.name(),
  email: fake.email({ number: true }),
  password: HASHED,
  role: "user",
  emailVerifiedAt: new Date(),
}));
