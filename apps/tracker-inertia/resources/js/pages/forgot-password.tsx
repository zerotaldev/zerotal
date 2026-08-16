import type { FormEvent, ReactNode } from "react";
import { Head, Link, useForm } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { Button } from "../Components/Button";
import { Card } from "../Components/Card";
import { TextField } from "../Components/Field";

interface Props {
  title: string;
}

function ForgotPassword({ title }: Props) {
  const { data, setData, post, processing, errors } = useForm({ email: "" });

  function submit(event: FormEvent) {
    event.preventDefault();
    post("/forgot-password");
  }

  return (
    <>
      <Head title={title} />

      <div className="mx-auto max-w-md">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-balance">{title}</h1>
          <p className="mt-2 text-muted-foreground">
            Give us the address you signed up with and we will send a link.
          </p>
        </header>

        <Card className="mt-8 p-6 sm:p-8">
          <form onSubmit={submit} className="space-y-5">
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              hint="In development the link is written to the server log rather than emailed."
              value={data.email}
              error={errors.email}
              onChange={(e) => setData("email", e.target.value)}
              required
            />

            <Button type="submit" disabled={processing}>
              {processing ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-sm text-muted-foreground">
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </>
  );
}

(ForgotPassword as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AppLayout>{page}</AppLayout>
);

export default ForgotPassword;
