import type { FormEvent, ReactNode } from "react";
import { Head, Link, useForm } from "@inertiajs/react";
import AuthLayout from "../../Layouts/AuthLayout";
import { Button } from "../../Components/Button";
import { TextField } from "../../Components/Field";

interface Props {
  title: string;
  /** Mail is printed by the server rather than sent (MAIL_DRIVER=log). */
  mailIsLogged: boolean;
}

function ForgotPassword({ title, mailIsLogged }: Props) {
  const form = useForm({ email: "" });

  function submit(event: FormEvent) {
    event.preventDefault();
    form.post(route("forgot-password.store"));
  }

  return (
    <>
      <Head title={title} />

      <form onSubmit={submit} className="space-y-5">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          hint={
            mailIsLogged
              ? "Mail is printed in the terminal running the server, not sent (MAIL_DRIVER=log)."
              : undefined
          }
          value={form.data.email}
          error={form.errors.email}
          onChange={(e) => form.setData("email", e.target.value)}
          required
        />

        <Button type="submit" className="w-full" disabled={form.processing}>
          {form.processing ? "Sending…" : "Email me a reset link"}
        </Button>
      </form>
    </>
  );
}

ForgotPassword.layout = (page: ReactNode) => (
  <AuthLayout
    title="Forgot your password?"
    description="Enter the address you signed up with and we will send you a link to choose a new one."
    footer={
      <Link href={route("login")} className="font-medium text-primary hover:underline">
        Back to sign in
      </Link>
    }
  >
    {page}
  </AuthLayout>
);

export default ForgotPassword;
