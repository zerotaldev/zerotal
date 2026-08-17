import type { FormEvent, ReactNode } from "react";
import { Head, useForm } from "@inertiajs/react";
import AuthLayout from "../Layouts/AuthLayout";
import { Button } from "../Components/Button";
import { TextField } from "../Components/Field";
import { endpoint } from "../lib/endpoint";

interface Props {
  title: string;
}

function ForgotPassword({ title }: Props) {
  const { data, setData, submit: submitForm, processing, errors } = useForm({ email: "" });
  function submit(event: FormEvent) {
    event.preventDefault();
    const { url, method } = endpoint("forgot-password.store");
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
          hint={__("In development the link is written to the server log rather than emailed.")}
          value={data.email}
          error={errors.email}
          onChange={(e) => setData("email", e.target.value)}
          required
        />

        <Button type="submit" disabled={processing} className="w-full">
          {processing ? __("Sending…") : __("Send reset link")}
        </Button>
      </form>
    </>
  );
}

(ForgotPassword as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AuthLayout
    title="Reset your password"
    subtitle="We will email you a link to set a new one."
    footer={{ text: "Remembered it?", link: "Sign in", href: route("login") }}
  >
    {page}
  </AuthLayout>
);

export default ForgotPassword;
