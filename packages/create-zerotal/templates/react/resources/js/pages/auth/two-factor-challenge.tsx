import { useState, type FormEvent, type ReactNode } from "react";
import { Head, Link, useForm } from "@inertiajs/react";
import AuthLayout from "../../Layouts/AuthLayout";
import { Button } from "../../Components/Button";
import { TextField } from "../../Components/Field";

interface Props {
  title: string;
}

function TwoFactorChallenge({ title }: Props) {
  // A lost phone is what recovery codes are for, so the form offers both.
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const form = useForm({ code: "", recovery_code: "" });

  function submit(event: FormEvent) {
    event.preventDefault();
    form.transform((data) =>
      useRecoveryCode ? { recovery_code: data.recovery_code } : { code: data.code },
    );
    form.post(route("two-factor.challenge.store"), { onFinish: () => form.reset() });
  }

  function toggle() {
    setUseRecoveryCode((value) => !value);
    form.clearErrors();
    form.reset();
  }

  return (
    <>
      <Head title={title} />

      <form onSubmit={submit} className="space-y-5">
        {useRecoveryCode ? (
          <TextField
            key="recovery"
            label="Recovery code"
            autoComplete="off"
            autoFocus
            spellCheck={false}
            hint="One of the codes you saved when you turned two-factor on. Each works once."
            value={form.data.recovery_code}
            error={form.errors.recovery_code}
            onChange={(e) => form.setData("recovery_code", e.target.value)}
            required
          />
        ) : (
          <TextField
            key="code"
            label="Authentication code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            placeholder="123456"
            className="text-center font-mono text-lg tracking-[0.4em]"
            value={form.data.code}
            error={form.errors.code}
            onChange={(e) => form.setData("code", e.target.value)}
            required
          />
        )}

        <Button type="submit" className="w-full" disabled={form.processing}>
          {form.processing ? "Checking…" : "Continue"}
        </Button>

        <button
          type="button"
          onClick={toggle}
          className="w-full text-center text-sm font-medium text-primary hover:underline"
        >
          {useRecoveryCode
            ? "Use a code from my app instead"
            : "Lost your phone? Use a recovery code"}
        </button>
      </form>
    </>
  );
}

TwoFactorChallenge.layout = (page: ReactNode) => (
  <AuthLayout
    title="Two-factor authentication"
    description="Enter the six-digit code from your authenticator app."
    footer={
      <Link href={route("login")} className="font-medium text-primary hover:underline">
        Sign in as someone else
      </Link>
    }
  >
    {page}
  </AuthLayout>
);

export default TwoFactorChallenge;
