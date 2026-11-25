import { postJson } from "./http";
import { createPasskey, getPasskey, passkeysSupported, wasCancelled } from "./passkeys";
import { toast } from "./toasts";

/**
 * Where the pages use passkeys: signing in with one (`[data-passkey-login]` on the sign-in
 * page) and adding one (`form[data-passkey-register]` in Settings → Passkeys).
 *
 * Both are offered only by a browser that can use them: anything marked
 * `data-passkey-only` is hidden until this script finds that it can, and anything marked
 * `data-passkey-unsupported` is shown only when it can't.
 */

/** A name to suggest for a new passkey, from what this browser says it is running on. */
function suggestedName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Passkey";
}

function report(error: unknown): void {
  if (!wasCancelled(error)) toast("error", error instanceof Error ? error.message : String(error));
}

function label(button: HTMLButtonElement, text: string | undefined): void {
  const target = button.querySelector("[data-label]") ?? button;
  if (text !== undefined) target.textContent = text;
}

async function signIn(button: HTMLButtonElement): Promise<void> {
  const idle = button.querySelector("[data-label]")?.textContent ?? undefined;
  button.disabled = true;
  label(button, "Waiting for your passkey…");
  try {
    const options = await postJson<Parameters<typeof getPasskey>[0]>("/passkeys/login/options");
    if (!options.ok) throw new Error("Passkey sign-in is not available right now.");
    const assertion = await getPasskey(options.data);
    const result = await postJson<{ redirect?: string; message?: string }>(
      "/passkeys/login",
      assertion,
    );
    if (!result.ok || !result.data.redirect)
      throw new Error(result.data.message ?? "That passkey did not work.");
    window.location.assign(result.data.redirect);
  } catch (error) {
    report(error);
    button.disabled = false;
    label(button, idle);
  }
}

async function register(form: HTMLFormElement, button: HTMLButtonElement | null): Promise<void> {
  const name = new FormData(form).get("name");
  const idle = button?.textContent ?? undefined;
  if (button) {
    button.disabled = true;
    button.textContent = "Waiting for your device…";
  }
  try {
    const options = await postJson<Parameters<typeof createPasskey>[0]>(
      "/settings/passkeys/options",
    );
    if (!options.ok) throw new Error("Could not start adding a passkey. Reload and try again.");
    const credential = await createPasskey(options.data);
    const saved = await postJson<{ message?: string }>("/settings/passkeys", { name, credential });
    if (!saved.ok) throw new Error(saved.data.message ?? "That passkey could not be saved.");
    // The route flashed "… was added"; the reload shows it with the new list.
    window.location.reload();
  } catch (error) {
    report(error);
    if (button) {
      button.disabled = false;
      if (idle !== undefined) button.textContent = idle;
    }
  }
}

export function installPasskeys(): void {
  const supported = passkeysSupported();
  for (const el of document.querySelectorAll<HTMLElement>("[data-passkey-only]"))
    el.hidden = !supported;
  for (const el of document.querySelectorAll<HTMLElement>("[data-passkey-unsupported]"))
    el.hidden = supported;
  for (const el of document.querySelectorAll<HTMLButtonElement>(
    "[data-passkey-requires-support]",
  )) {
    el.disabled = !supported;
  }
  for (const input of document.querySelectorAll<HTMLInputElement>(
    "input[data-suggest-passkey-name]",
  )) {
    if (!input.value) input.value = suggestedName();
  }

  document.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-passkey-login]");
    if (button && !button.disabled) void signIn(button);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    if (!form.matches("[data-passkey-register]")) return;
    event.preventDefault();
    void register(form, (event as SubmitEvent).submitter as HTMLButtonElement | null);
  });
}
