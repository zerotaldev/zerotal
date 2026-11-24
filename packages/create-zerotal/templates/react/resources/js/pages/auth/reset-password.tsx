import type { FormEvent, ReactNode } from "react";
import { Head, useForm } from "@inertiajs/react";
import AuthLayout from "../../Layouts/AuthLayout";
import { Button } from "../../Components/Button";
import { TextField } from "../../Components/Field";

interface Props {
  title: string;
  /** Both arrive on the query string of the emailed link. */
  token: string;
  email: string;
}

function ResetPassword({ title, token, email }: Props) {
  // Token and email ride along with the new password, so the POST carries everything
  // the server needs to check the link without trusting the session.
  const form = useForm({ token, email, password: "", password_confirmation: "" });

  function submit(event: FormEvent) {
    event.preventDefault();
    form.post(route("reset-password.store"), {
      onFinish: () => form.reset("password", "password_confirmation"),
    });
  }

  return (
    <>
      <Head title={title} />

      <form onSubmit={submit} className="space-y-5">
        <TextField label="Email" type="email" value={form.data.email} readOnly />

        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          autoFocus
          hint="At least 8 characters."
          value={form.data.password}
          error={form.errors.password}
          onChange={(e) => form.setData("password", e.target.value)}
          required
        />

        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={form.data.password_confirmation}
          error={form.errors.password_confirmation}
          onChange={(e) => form.setData("password_confirmation", e.target.value)}
          required
        />

        <Button type="submit" className="w-full" disabled={form.processing}>
          {form.processing ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </>
  );
}

ResetPassword.layout = (page: ReactNode) => (
  <AuthLayout title="Choose a new password">{page}</AuthLayout>
);

export default ResetPassword;
