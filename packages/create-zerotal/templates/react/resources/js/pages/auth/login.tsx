import { useState, type FormEvent, type ReactNode } from "react";
import { Head, Link, router, useForm } from "@inertiajs/react";
import AuthLayout from "../../Layouts/AuthLayout";
import { Button } from "../../Components/Button";
import { Checkbox } from "../../Components/Checkbox";
import { TextField } from "../../Components/Field";
import { FingerprintIcon } from "../../Components/Icons";
import { Divider, SocialButtons } from "../../Components/SocialButtons";
import { toast } from "../../Components/Toasts";
import { postJson } from "../../lib/http";
import { getPasskey, passkeysSupported, wasCancelled } from "../../lib/passkeys";

interface Props {
  title: string;
  /** Passkey sign-in is on (PASSKEY_RP_ID is set). */
  passkeys: boolean;
  /** Social providers switched on in config/social.ts. */
  providers: string[];
}

function Login({ title, passkeys, providers }: Props) {
  const form = useForm({ email: "", password: "", remember: false });
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    // The password is cleared whichever way it goes, so it never sits in the DOM.
    form.post(route("login.store"), { onFinish: () => form.reset("password") });
  }

  async function signInWithPasskey() {
    setPasskeyBusy(true);
    try {
      const options = await postJson<Parameters<typeof getPasskey>[0]>("/passkeys/login/options");
      if (!options.ok) throw new Error("Passkey sign-in is not available right now.");
      const assertion = await getPasskey(options.data);
      const result = await postJson<{ redirect?: string; message?: string }>("/passkeys/login", assertion);
      if (!result.ok || !result.data.redirect) throw new Error(result.data.message ?? "That passkey did not work.");
      router.visit(result.data.redirect);
    } catch (error) {
      if (!wasCancelled(error)) toast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setPasskeyBusy(false);
    }
  }

  const offerPasskey = passkeys && passkeysSupported();

  return (
    <>
      <Head title={title} />

      {offerPasskey || providers.length > 0 ? (
        <div className="mb-6 space-y-3">
          {offerPasskey ? (
            <Button
              variant="secondary"
              className="w-full"
              onClick={signInWithPasskey}
              disabled={passkeyBusy}
            >
              <FingerprintIcon className="size-4.5" />
              {passkeyBusy ? "Waiting for your passkey…" : "Sign in with a passkey"}
            </Button>
          ) : null}
          <SocialButtons providers={providers} />
          <div className="pt-3">
            <Divider label="or with email" />
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-5">
        <TextField
          label="Email"
          type="email"
          // `webauthn` lets the browser offer a saved passkey right in the field.
          autoComplete={passkeys ? "username webauthn" : "username"}
          autoFocus
          value={form.data.email}
          error={form.errors.email}
          onChange={(e) => form.setData("email", e.target.value)}
          required
        />

        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={form.data.password}
          error={form.errors.password}
          onChange={(e) => form.setData("password", e.target.value)}
          aside={
            <Link
              href={route("forgot-password")}
              className="text-sm font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          }
          required
        />

        <Checkbox
          label="Keep me signed in"
          checked={form.data.remember}
          onChange={(e) => form.setData("remember", e.target.checked)}
        />

        <Button type="submit" className="w-full" disabled={form.processing}>
          {form.processing ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </>
  );
}

Login.layout = (page: ReactNode) => (
  <AuthLayout
    title="Sign in to your account"
    description="Welcome back. Enter your details to continue."
    footer={
      <>
        New here?{" "}
        <Link href={route("register")} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </>
    }
  >
    {page}
  </AuthLayout>
);

export default Login;
