import type { HttpContext } from "zerotal";
import { NotFoundError } from "zerotal";
import { Auth } from "zerotal/auth";
import { deletePasskey } from "@app/auth/passkeys";

// DELETE /settings/passkeys/:passkey — only ever one of the signed-in user's own.
export async function DELETE(http: HttpContext): Promise<void> {
  const removed = await deletePasskey(Auth.user().id, Number(http.params["passkey"]));
  if (!removed) throw new NotFoundError();

  http.flash("success", "Passkey removed. It can no longer be used to sign in.");
  http.redirect("/settings/passkeys", 303);
}
