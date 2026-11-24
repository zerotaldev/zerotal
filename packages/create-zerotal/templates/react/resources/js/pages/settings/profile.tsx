import type { FormEvent, ReactNode } from "react";
import { Head, useForm, usePage } from "@inertiajs/react";
import SettingsLayout from "../../Layouts/SettingsLayout";
import { Alert } from "../../Components/Alert";
import { Button } from "../../Components/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../Components/Card";
import { TextField } from "../../Components/Field";
import type { SharedProps } from "../../types";

interface Props {
  title: string;
  emailVerified: boolean;
}

function Profile({ title, emailVerified }: Props) {
  const { auth } = usePage<SharedProps>().props;
  const form = useForm({ name: auth.user?.name ?? "", email: auth.user?.email ?? "" });
  const resend = useForm({});

  function submit(event: FormEvent) {
    event.preventDefault();
    form.patch(route("settings.profile.update"), { preserveScroll: true });
  }

  return (
    <>
      <Head title={title} />

      {!emailVerified ? (
        <Alert
          tone="warning"
          title="Your email address is not confirmed yet"
          actions={
            <Button
              size="sm"
              variant="secondary"
              disabled={resend.processing}
              onClick={() => resend.post(route("verify-email.store"), { preserveScroll: true })}
            >
              Send the link again
            </Button>
          }
        >
          Until it is, the dashboard and projects stay locked. Check your inbox for the link.
        </Alert>
      ) : null}

      <Card>
        <form onSubmit={submit}>
          <CardHeader title="Profile" description="Your name, and the address we email." />
          <CardBody className="space-y-5">
            <TextField
              label="Name"
              autoComplete="name"
              value={form.data.name}
              error={form.errors.name}
              onChange={(e) => form.setData("name", e.target.value)}
              required
            />
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              hint="Changing it sends a link to the new address to confirm it."
              value={form.data.email}
              error={form.errors.email}
              onChange={(e) => form.setData("email", e.target.value)}
              required
            />
          </CardBody>
          <CardFooter>
            <Button type="submit" disabled={form.processing || !form.isDirty}>
              {form.processing ? "Saving…" : "Save"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </>
  );
}

Profile.layout = (page: ReactNode) => <SettingsLayout>{page}</SettingsLayout>;

export default Profile;
