import type { HttpContext } from "zerotal";
import { Inertia } from "@zerotal/inertia";
import { Auth } from "zerotal/auth";
import { validate } from "zerotal/validator";
import { intendedUrl } from "@app/support/redirects";
import { rejectInput } from "@app/support/validation";

/**
 * "Confirm your password to continue."
 *
 * `ConfirmPasswordMiddleware` sends a user here before a sensitive page — two-factor
 * and passkey settings — unless they entered their password in the last three hours.
 * A borrowed laptop with a live session is then not enough to turn two-factor off.
 */

// GET /confirm-password
export const GET = async () => {
  return Inertia.render("auth/confirm-password", { title: "Confirm your password" });
};

// POST /confirm-password
export async function POST(http: HttpContext): Promise<void> {
  const { password } = await validate(http, (r) => ({ password: r.string().min(1) }));

  if (!(await Auth.confirmPassword(password))) {
    rejectInput(http, { password: "That password is not correct." }, "/confirm-password");
  }

  http.redirect(intendedUrl(http, "/settings"), 303);
}
