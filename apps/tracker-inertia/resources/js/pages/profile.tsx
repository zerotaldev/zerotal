import type { FormEvent, ReactNode } from "react";
import { Head, router, useForm, usePage } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { Button } from "../Components/Button";
import { Card } from "../Components/Card";
import { TextField } from "../Components/Field";
import type { SharedProps } from "../types";

interface Props {
  title: string;
}

function Profile({ title }: Props) {
  // `auth.user` is shared into every page by @zerotal/inertia, so this route
  // does not have to pass the signed-in user as a prop.
  const { auth } = usePage<SharedProps>().props;

  const details = useForm({
    name: auth.user?.name ?? "",
    email: auth.user?.email ?? "",
  });

  const password = useForm({
    current_password: "",
    password: "",
    password_confirmation: "",
  });

  function saveDetails(event: FormEvent) {
    event.preventDefault();
    details.post("/profile", { preserveScroll: true });
  }

  function changePassword(event: FormEvent) {
    event.preventDefault();
    // Clear the fields whichever way it goes — a failed attempt should not
    // leave the old password sitting in the DOM.
    password.post("/profile/password", {
      preserveScroll: true,
      onFinish: () => password.reset(),
    });
  }

  return (
    <>
      <Head title={title} />

      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-balance">{title}</h1>
          <p className="mt-2 text-muted-foreground">Update your details or change your password.</p>
        </header>

        <Card className="p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Details</h2>

          <form onSubmit={saveDetails} className="mt-4 space-y-5">
            <TextField
              label="Name"
              autoComplete="name"
              value={details.data.name}
              error={details.errors.name}
              onChange={(e) => details.setData("name", e.target.value)}
              required
            />

            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              value={details.data.email}
              error={details.errors.email}
              onChange={(e) => details.setData("email", e.target.value)}
              required
            />

            <Button type="submit" disabled={details.processing}>
              {details.processing ? "Saving…" : "Save details"}
            </Button>
          </form>
        </Card>

        <Card className="p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Password</h2>

          <form onSubmit={changePassword} className="mt-4 space-y-5">
            <TextField
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={password.data.current_password}
              error={password.errors.current_password}
              onChange={(e) => password.setData("current_password", e.target.value)}
              required
            />

            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters."
              value={password.data.password}
              error={password.errors.password}
              onChange={(e) => password.setData("password", e.target.value)}
              required
            />

            <TextField
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={password.data.password_confirmation}
              error={password.errors.password_confirmation}
              onChange={(e) => password.setData("password_confirmation", e.target.value)}
              required
            />

            <Button type="submit" disabled={password.processing}>
              {password.processing ? "Updating…" : "Change password"}
            </Button>
          </form>
        </Card>

        <Card className="p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Session</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sign out of this browser.</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => router.post("/logout")}
          >
            Sign out
          </Button>
        </Card>
      </div>
    </>
  );
}

(Profile as { layout?: (page: ReactNode) => ReactNode }).layout = (page) => (
  <AppLayout>{page}</AppLayout>
);

export default Profile;
