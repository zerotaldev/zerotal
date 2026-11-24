import { useState, type ReactNode } from "react";
import { Head } from "@inertiajs/react";
import SettingsLayout from "../../Layouts/SettingsLayout";
import { Button } from "../../Components/Button";
import { Card, CardFooter, CardHeader } from "../../Components/Card";
import { PasswordDialog } from "../../Components/PasswordDialog";

interface Props {
  title: string;
}

function DeleteAccount({ title }: Props) {
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Head title={title} />

      <Card className="border-destructive/40">
        <CardHeader
          title="Delete account"
          description="Your account and everything in it — projects, passkeys, sessions — is removed for good. There is no undo."
        />
        <CardFooter className="mt-5 border-destructive/20 bg-destructive/5">
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete my account
          </Button>
        </CardFooter>
      </Card>

      <PasswordDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete your account?"
        description="This cannot be undone. Enter your password to confirm."
        method="delete"
        url={route("settings.delete-account.destroy")}
        confirmLabel="Delete account"
        action="Deleting…"
      />
    </>
  );
}

DeleteAccount.layout = (page: ReactNode) => <SettingsLayout>{page}</SettingsLayout>;

export default DeleteAccount;
