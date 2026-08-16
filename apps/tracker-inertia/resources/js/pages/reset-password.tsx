import type { FormEvent, ReactNode } from "react";
import { Head, useForm } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { Button } from "../Components/Button";
import { Card } from "../Components/Card";
import { TextField } from "../Components/Field";

interface Props {
  title: string;
  /** Both arrive on the query string of the emailed link. */
  token: string;
  email: string;
}

function ResetPassword({ title, token, email }: Props) {
  // Token and email ride along as hidden fields so the POST carries everything
  // the server needs to verify the link without trusting the session.
  const { data, setData, post, processing, errors } = useForm({
    token,
    email,
    password: "",
    password_confirmation: "",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    post("/reset-password");
  }

  return (
    <>
      <Head title={title} />

      <div className="mx-auto max-w-md">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-balance">{title}</h1>
          <p className="mt-2 text-muted-foreground">Resetting the password for {email}.</p>
        </header>

        <Card className="mt-8 p-6 sm:p-8">
          <form onSubmit={submit} className="space-y-5">
            <input type="hidden" value={data.token} />
            <input type="hidden" value={data.email} />

            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters."
              value={data.password}
              error={errors.password}
              onChange={(e) => setData("password", e.target.value)}
              required
            />

            <TextField
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={data.password_confirmation}
              error={errors.password_confirmation}
              onChange={(e) => setData("password_confirmation", e.target.value)}
              required
            />

            <Button type="submit" disabled={processing}>
              {processing ? "Updating…" : "Update password"}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

(ResetPassword as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AppLayout>{page}</AppLayout>
);

export default ResetPassword;
