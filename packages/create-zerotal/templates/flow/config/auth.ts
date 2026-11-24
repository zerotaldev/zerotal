import { AuthConfig } from "zerotal/auth";
import app from "./app";

export default AuthConfig({
  // argon2id is the default and what `Hash.make` uses unless told otherwise.
  // Switch to 'bcrypt' only to stay compatible with an existing password table.
  algorithm: "argon2id",

  twoFactor: {
    // The label an authenticator app shows above the six-digit code. Read from
    // config/app.ts so a renamed app does not leave codes filed under the old name.
    issuer: app.name,
    // One 30-second step either side of now, for a phone whose clock has drifted.
    window: 1,
    recoveryCodeCount: 8,
  },
});
