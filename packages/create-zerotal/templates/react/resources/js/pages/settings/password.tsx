import type { FormEvent, ReactNode } from "react";
import { Head, useForm } from "@inertiajs/react";
import SettingsLayout from "../../Layouts/SettingsLayout";
import { Button } from "../../Components/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../Components/Card";
import { TextField } from "../../Components/Field";

interface Props {
  title: string;
}

function Password({ title }: Props) {
  const form = useForm({ current_password: "", password: "", password_confirmation: "" });

  function submit(event: FormEvent) {
    event.preventDefault();
    // Cleared whichever way it goes, so no password is left sitting in the DOM.
    form.put(route("settings.password.update"), {
      preserveScroll: true,
      onFinish: () => form.reset(),
    });
  }

  return (
    <>
      <Head title={title} />

      <Card>
        <form onSubmit={submit}>
          <CardHeader
            title="Change password"
            description="Changing it signs you out on every other device."
          />
          <CardBody className="space-y-5">
            <TextField
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={form.data.current_password}
              error={form.errors.current_password}
              onChange={(e) => form.setData("current_password", e.target.value)}
              required
            />
            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters."
              value={form.data.password}
              error={form.errors.password}
              onChange={(e) => form.setData("password", e.target.value)}
              required
            />
            <TextField
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={form.data.password_confirmation}
              error={form.errors.password_confirmation}
              onChange={(e) => form.setData("password_confirmation", e.target.value)}
              required
            />
          </CardBody>
          <CardFooter>
            <Button type="submit" disabled={form.processing}>
              {form.processing ? "Saving…" : "Change password"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </>
  );
}

Password.layout = (page: ReactNode) => <SettingsLayout>{page}</SettingsLayout>;

export default Password;
