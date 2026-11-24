import { ConfirmPasswordMiddleware } from "zerotal/auth";

// Turning two-factor on or off, and seeing recovery codes, asks for the password again
// if it has not been entered in the last three hours. See app/routes/(auth)/confirm-password.ts.
export const middleware = [ConfirmPasswordMiddleware];
