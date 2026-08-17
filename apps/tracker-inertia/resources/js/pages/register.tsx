import type { FormEvent, ReactNode } from "react";
import { Head, useForm } from "@inertiajs/react";
import AuthLayout from "../Layouts/AuthLayout";
import { Button } from "../Components/Button";
import { TextField } from "../Components/Field";
import { endpoint } from "../lib/endpoint";

interface Props {
  title: string;
}

function Register({ title }: Props) {
  const {
    data,
    setData,
    submit: submitForm,
    processing,
    errors,
  } = useForm({
    name: "",
    email: "",
    password: "",
    password_confirmation: "",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const { url, method } = endpoint("register.store");
    submitForm(method, url);
  }

  return (
    <>
      <Head title={title} />

      <form onSubmit={submit} className="space-y-5">
        <TextField
          label={__("Name")}
          autoComplete="name"
          value={data.name}
          error={errors.name}
          onChange={(e) => setData("name", e.target.value)}
          required
        />

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
          autoComplete="new-password"
          hint={__("At least 8 characters.")}
          value={data.password}
          error={errors.password}
          onChange={(e) => setData("password", e.target.value)}
          required
        />

        <TextField
          label={__("Confirm password")}
          type="password"
          autoComplete="new-password"
          value={data.password_confirmation}
          error={errors.password_confirmation}
          onChange={(e) => setData("password_confirmation", e.target.value)}
          required
        />

        <Button type="submit" disabled={processing} className="w-full">
          {processing ? __("Creating…") : __("Create an account")}
        </Button>
      </form>
    </>
  );
}

(Register as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AuthLayout
    title="Create an account"
    subtitle="It takes about ten seconds."
    footer={{ text: "Already registered?", link: "Sign in", href: route("login") }}
  >
    {page}
  </AuthLayout>
);

export default Register;
