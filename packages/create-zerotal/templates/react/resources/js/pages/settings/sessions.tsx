import { useState, type ReactNode } from "react";
import { Head } from "@inertiajs/react";
import SettingsLayout from "../../Layouts/SettingsLayout";
import { Badge } from "../../Components/Badge";
import { Button } from "../../Components/Button";
import { Card, CardFooter, CardHeader } from "../../Components/Card";
import { MonitorIcon, PhoneIcon } from "../../Components/Icons";
import { PasswordDialog } from "../../Components/PasswordDialog";
import { timeAgo } from "../../lib/format";

interface Session {
  id: string;
  browser: string;
  platform: string;
  ipAddress: string | null;
  lastActiveAt: string;
  current: boolean;
}

interface Props {
  title: string;
  sessions: Session[];
}

function Sessions({ title, sessions }: Props) {
  const [confirming, setConfirming] = useState(false);
  const others = sessions.filter((session) => !session.current).length;

  return (
    <>
      <Head title={title} />

      <Card>
        <CardHeader
          title="Where you're signed in"
          description="If you don't recognise a device, sign it out and change your password."
        />
        <ul className="divide-y divide-border border-y border-border">
          {sessions.map((session) => {
            const Icon = /iOS|Android/.test(session.platform) ? PhoneIcon : MonitorIcon;
            return (
              <li key={session.id} className="flex items-center gap-4 px-5 py-4 sm:px-6">
                <Icon className="size-6 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {session.browser} on {session.platform}
                    {session.current ? <Badge tone="success">This device</Badge> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {session.ipAddress ?? "Unknown address"} ·{" "}
                    {session.current
                      ? "Active now"
                      : `Last active ${timeAgo(session.lastActiveAt)}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <CardFooter className="rounded-t-none border-t-0">
          <Button variant="secondary" onClick={() => setConfirming(true)} disabled={others === 0}>
            Sign out other sessions
          </Button>
        </CardFooter>
      </Card>

      <PasswordDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Sign out other sessions?"
        description="Every other browser and device will be signed out. Enter your password to confirm."
        method="delete"
        url={route("settings.sessions.destroy")}
        confirmLabel="Sign them out"
        action="Signing out…"
        variant="primary"
      />
    </>
  );
}

Sessions.layout = (page: ReactNode) => <SettingsLayout>{page}</SettingsLayout>;

export default Sessions;
