import { AuthConfig } from "zerotal/auth";

export default AuthConfig({
  // argon2id is the default and what `Hash.make` uses unless told otherwise.
  // Switch to 'bcrypt' only to stay compatible with an existing password table.
  algorithm: "argon2id",
});
