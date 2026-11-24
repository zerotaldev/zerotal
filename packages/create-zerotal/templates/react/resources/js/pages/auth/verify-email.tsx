import type { ReactNode } from "react";
import { Head, Link, useForm } from "@inertiajs/react";
import AuthLayout from "../../Layouts/AuthLayout";
import { Button } from "../../Components/Button";
import { MailIcon } from "../../Components/Icon";

interface Props {
  title: string;
  email: string;
  /** Mail is printed by the server rather than sent (MAIL_DRIVER=log). */
  mailIsLogged: boolean;
}

function VerifyEmail({ title, email, mailIsLogged }: Props) {
  const resend = useForm({});

  return (
    <>
      <Head title={title} />

      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
        <MailIcon className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          We sent a link to <span className="font-medium text-foreground">{email}</span>. Open it on
          this device to confirm the address. The link expires in an hour.
        </p>
      </div>

      {mailIsLogged ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Working locally? The mail driver is <code className="font-mono text-foreground">log</code>
          , so the message — link included — is printed in the terminal running the server.
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          onClick={() => resend.post(route("verify-email.store"))}
          disabled={resend.processing}
        >
          {resend.processing ? "Sending…" : "Send the link again"}
        </Button>
        <Link
          href={route("settings.profile")}
          className="text-sm font-medium text-primary hover:underline"
        >
          Wrong address? Change it
        </Link>
      </div>
    </>
  );
}

VerifyEmail.layout = (page: ReactNode) => (
  <AuthLayout
    title="Check your inbox"
    description="One more step: confirm your email address."
    footer={
      <Link
        href={route("logout.store")}
        method="post"
        as="button"
        className="font-medium text-primary hover:underline"
      >
        Sign out
      </Link>
    }
  >
    {page}
  </AuthLayout>
);

export default VerifyEmail;
