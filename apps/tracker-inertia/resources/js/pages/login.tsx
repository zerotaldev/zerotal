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

function Login({ title }: Props) {
  const { old } = usePage<SharedProps>().props;

  const { data, setData, post, processing, errors } = useForm({
    email: typeof old["email"] === "string" ? old["email"] : "",
    password: "",
    remember: false,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    post("/login");
  }

  return (
    <>
      <Head title={title} />

      <div className="mx-auto max-w-md">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-balance">{title}</h1>
          <p className="mt-2 text-muted-foreground">Enter your details to continue.</p>
        </header>

        <Card className="mt-8 p-6 sm:p-8">
          <form onSubmit={submit} className="space-y-5">
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
              autoComplete="current-password"
              value={data.password}
              error={errors.password}
              onChange={(e) => setData("password", e.target.value)}
              required
            />

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="rounded border-input"
                checked={data.remember}
                onChange={(e) => setData("remember", e.target.checked)}
              />
              Remember me
            </label>

            <Button type="submit" disabled={processing}>
              {processing ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="text-accent hover:underline">
            Forgot your password?
          </Link>
          <Link href="/register" className="text-accent hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </>
  );
}

(Login as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AppLayout>{page}</AppLayout>
);

export default Login;
