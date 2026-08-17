import type { FormEvent, ReactNode } from "react";
import { Head, useForm } from "@inertiajs/react";
import AuthLayout from "../Layouts/AuthLayout";
import { Button } from "../Components/Button";
import { TextField } from "../Components/Field";
import { endpoint } from "../lib/endpoint";

interface Props {
  title: string;
  /** Both arrive on the query string of the emailed link. */
  token: string;
  email: string;
}

function ResetPassword({ title, token, email }: Props) {
  // Token and email ride along as hidden fields so the POST carries everything
  // the server needs to verify the link without trusting the session.
  const {
    data,
    setData,
    submit: submitForm,
    processing,
    errors,
  } = useForm({
    token,
    email,
    password: "",
    password_confirmation: "",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const { url, method } = endpoint("reset-password.store");
    submitForm(method, url);
  }

  return (
    <>
      <Head title={title} />

      <form onSubmit={submit} className="space-y-5">
        <input type="hidden" value={data.token} />
        <input type="hidden" value={data.email} />

        <TextField
          label={__("New password")}
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
          {processing ? __("Updating…") : __("Update password")}
        </Button>
      </form>
    </>
  );
}

(ResetPassword as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AuthLayout
    title="Choose a new password"
    subtitle="Then sign in with it."
    footer={{ text: "Changed your mind?", link: "Back to sign in", href: route("login") }}
  >
    {page}
  </AuthLayout>
);

export default ResetPassword;
