import type { FormEvent, ReactNode } from "react";
import { Head, Link, useForm, usePage } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { Button } from "../Components/Button";
import { Card } from "../Components/Card";
import { TextField } from "../Components/Field";
import type { SharedProps } from "../types";

interface Props {
  title: string;
}

function Register({ title }: Props) {
  const { old } = usePage<SharedProps>().props;

  const { data, setData, post, processing, errors } = useForm({
    name: typeof old["name"] === "string" ? old["name"] : "",
    email: typeof old["email"] === "string" ? old["email"] : "",
    password: "",
    password_confirmation: "",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    post("/register");
  }

  return (
    <>
      <Head title={title} />

      <div className="mx-auto max-w-md">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-balance">{title}</h1>
          <p className="mt-2 text-muted-foreground">It takes about ten seconds.</p>
        </header>

        <Card className="mt-8 p-6 sm:p-8">
          <form onSubmit={submit} className="space-y-5">
            <TextField
              label="Name"
              autoComplete="name"
              value={data.name}
              error={errors.name}
              onChange={(e) => setData("name", e.target.value)}
              required
            />

            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              value={data.email}
              error={errors.email}
              onChange={(e) => setData("email", e.target.value)}
              required
            />

            <TextField
              label="Password"
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
              {processing ? "Creating…" : "Create account"}
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-sm text-muted-foreground">
          Already registered?{" "}
          <Link href={route("login")} className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}

(Register as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AppLayout>{page}</AppLayout>
);

export default Register;
