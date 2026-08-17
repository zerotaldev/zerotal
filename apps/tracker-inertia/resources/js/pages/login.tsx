import type { FormEvent, ReactNode } from "react";
import { Head, Link, useForm, usePage } from "@inertiajs/react";
import AuthLayout from "../Layouts/AuthLayout";
import { Button } from "../Components/Button";
import { TextField } from "../Components/Field";
import type { SharedProps } from "../types";
import { endpoint } from "../lib/endpoint";

interface Props {
  title: string;
}

function Login({ title }: Props) {
  const { old } = usePage<SharedProps>().props;
  const {
    data,
    setData,
    submit: submitForm,
    processing,
    errors,
  } = useForm({
    email: typeof old["email"] === "string" ? old["email"] : "",
    password: "",
    remember: false,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const { url, method } = endpoint("login.store");
    submitForm(method, url);
  }

  return (
    <>
      <Head title={title} />

      <form onSubmit={submit} className="space-y-5">
        <TextField
          label={__("Email")}
          type="email"
          autoComplete="email"
          value={data.email}
          error={errors.email}
          onChange={(e) => setData("email", e.target.value)}
          required
        />

        <TextField
          label={__("Password")}
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
          {__("Remember me")}
        </label>

        <Button type="submit" disabled={processing} className="w-full">
          {processing ? __("Signing in…") : __("Sign in")}
        </Button>

        <p className="text-center text-sm">
          <Link
            href={route("forgot-password")}
            className="text-muted-foreground hover:text-foreground"
          >
            {__("Forgot your password?")}
          </Link>
        </p>
      </form>
    </>
  );
}

(Login as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AuthLayout
    title="Welcome back"
    subtitle="Sign in to your Tracker account."
    footer={{ text: "Don’t have an account?", link: "Create one", href: route("register") }}
  >
    {page}
  </AuthLayout>
);

export default Login;
