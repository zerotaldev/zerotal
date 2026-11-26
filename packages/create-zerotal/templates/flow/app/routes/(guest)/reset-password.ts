import type { HttpContext } from "zerotal";
import { validate } from "zerotal/validator";
import { passwordReset } from "@app/auth/passwords";
import { rejectInput } from "@app/support/validation";

// POST /reset-password
export async function POST(http: HttpContext): Promise<void> {
  const { email, token, password } = await validate(http, (r) => ({
    email: r.string().trim().email(),
    token: r.string().min(1),
    password: r.string().min(8),
    // Checked as its own field, so a mismatch is shown under "Confirm password" rather than
    // piled under "Password" with that field's own message.
    password_confirmation: r.string().sameAs("password", "The two passwords do not match."),
  }));

  if (!(await passwordReset.reset({ email, token, password }))) {
    const back = `/reset-password?${new URLSearchParams({ token, email })}`;
    rejectInput(
      http,
      { email: "This reset link is invalid or has expired. Ask for a new one." },
      back,
    );
  }

  http.flash("success", "Your password has been changed. Sign in with it below.");
  http.redirect("/login", 303);
}
