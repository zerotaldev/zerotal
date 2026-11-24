import type { FormEvent, ReactNode } from "react";
import { Head, Link, useForm } from "@inertiajs/react";
import AuthLayout from "../../Layouts/AuthLayout";
import { Button } from "../../Components/Button";
import { TextField } from "../../Components/Field";

interface Props {
  title: string;
}

function ConfirmPassword({ title }: Props) {
  const form = useForm({ password: "" });

  function submit(event: FormEvent) {
    event.preventDefault();
    form.post(route("confirm-password.store"), { onFinish: () => form.reset() });
  }

  return (
    <>
      <Head title={title} />

      <form onSubmit={submit} className="space-y-5">
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={form.data.password}
          error={form.errors.password}
          onChange={(e) => form.setData("password", e.target.value)}
          required
        />

        <Button type="submit" className="w-full" disabled={form.processing}>
          {form.processing ? "Checking…" : "Confirm"}
        </Button>
      </form>
    </>
  );
}

ConfirmPassword.layout = (page: ReactNode) => (
  <AuthLayout
    title="Confirm your password"
    description="This is a secure area. Enter your password to continue — you won't be asked again for a few hours."
    footer={
      <Link href={route("settings")} className="font-medium text-primary hover:underline">
        Back to settings
      </Link>
    }
  >
    {page}
  </AuthLayout>
);

export default ConfirmPassword;
