import type { FormEvent, ReactNode } from "react";
import { Head, Link, useForm } from "@inertiajs/react";
import AuthLayout from "../../Layouts/AuthLayout";
import { Button } from "../../Components/Button";
import { TextField } from "../../Components/Field";

interface Props {
  title: string;
}

function Register({ title }: Props) {
  const form = useForm({ name: "", email: "", password: "", password_confirmation: "" });

  function submit(event: FormEvent) {
    event.preventDefault();
    form.post(route("register.store"), {
      onFinish: () => form.reset("password", "password_confirmation"),
    });
  }

  return (
    <>
      <Head title={title} />

      <form onSubmit={submit} className="space-y-5">
        <TextField
          label="Name"
          autoComplete="name"
          autoFocus
          value={form.data.name}
          error={form.errors.name}
          onChange={(e) => form.setData("name", e.target.value)}
          required
        />

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={form.data.email}
          error={form.errors.email}
          onChange={(e) => form.setData("email", e.target.value)}
          required
        />

        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
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
          {form.processing ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </>
  );
}

Register.layout = (page: ReactNode) => (
  <AuthLayout
    title="Create an account"
    description="It takes about ten seconds."
    footer={
      <>
        Already have an account?{" "}
        <Link href={route("login")} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </>
    }
  >
    {page}
  </AuthLayout>
);

export default Register;
