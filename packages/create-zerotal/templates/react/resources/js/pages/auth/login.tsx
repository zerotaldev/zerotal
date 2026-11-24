import type { FormEvent, ReactNode } from "react";
import { Head, Link, useForm } from "@inertiajs/react";
import AuthLayout from "../../Layouts/AuthLayout";
import { Button } from "../../Components/Button";
import { Checkbox } from "../../Components/Checkbox";
import { TextField } from "../../Components/Field";

interface Props {
  title: string;
}

function Login({ title }: Props) {
  const form = useForm({ email: "", password: "", remember: false });

  function submit(event: FormEvent) {
    event.preventDefault();
    // The password is cleared whichever way it goes, so it never sits in the DOM.
    form.post(route("login.store"), { onFinish: () => form.reset("password") });
  }

  return (
    <>
      <Head title={title} />

      <form onSubmit={submit} className="space-y-5">
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
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
