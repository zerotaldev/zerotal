import { useState, type FormEvent, type ReactNode } from "react";
import { Head, router, useForm } from "@inertiajs/react";
import SettingsLayout from "../../Layouts/SettingsLayout";
import { Alert } from "../../Components/Alert";
import { Badge } from "../../Components/Badge";
import { Button } from "../../Components/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../Components/Card";
import { TextField } from "../../Components/Field";
import { Modal } from "../../Components/Modal";
import { toast } from "../../Components/Toasts";

interface Props {
  title: string;
  enabled: boolean;
  /** Present while setting up: the QR code, and the same secret as text and as a link. */
  setup: { qrSvg: string; uri: string; secret: string } | null;
  /** Present once, straight after codes are made. */
  recoveryCodes: string[] | null;
  recoveryCodesLeft: number;
}

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to type off a screen. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast("success", "Recovery codes copied.");
    } catch {
      toast("error", "Could not copy — select the codes and copy them yourself.");
    }
  }

  return (
    <Alert
      tone="warning"
      title="Save these recovery codes now"
      actions={
        <Button size="sm" variant="secondary" onClick={copy}>
          Copy codes
        </Button>
      }
    >
      <p>
        Each one signs you in once if you lose your phone. Keep them in a password manager. They
        will not be shown again.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-foreground">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </Alert>
  );
}

function TwoFactor({ title, enabled, setup, recoveryCodes, recoveryCodesLeft }: Props) {
  const confirm = useForm({ code: "" });
  const [disabling, setDisabling] = useState(false);

  function confirmCode(event: FormEvent) {
    event.preventDefault();
    confirm.post(route("settings.two-factor.confirm.store"), {
      preserveScroll: true,
      onFinish: () => confirm.reset(),
    });
  }

  return (
    <>
      <Head title={title} />

      {recoveryCodes ? <RecoveryCodes codes={recoveryCodes} /> : null}

      <Card>
        <CardHeader
          title="Two-factor authentication"
          description="Ask for a code from your phone, as well as your password, when you sign in."
          actions={
            enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>
          }
        />

        {enabled ? (
          <>
            <CardBody className="space-y-2 text-sm text-muted-foreground">
              <p>
                Signing in asks for the six-digit code from your authenticator app. You have{" "}
                <span className="font-medium text-foreground">{recoveryCodesLeft}</span> unused
                recovery code{recoveryCodesLeft === 1 ? "" : "s"} for when your phone is not to hand.
              </p>
            </CardBody>
            <CardFooter className="justify-between">
              <Button
                variant="secondary"
                onClick={() =>
                  router.post(route("settings.two-factor.recovery-codes.store"), {}, { preserveScroll: true })
                }
              >
                Make new recovery codes
              </Button>
              <Button variant="danger" onClick={() => setDisabling(true)}>
                Turn off
              </Button>
            </CardFooter>
          </>
        ) : setup ? (
          <form onSubmit={confirmCode}>
            <CardBody className="space-y-6">
              <ol className="space-y-6 text-sm">
                <li>
                  <p className="font-medium">1. Scan this with your authenticator app</p>
                  <p className="mt-1 text-muted-foreground">
                    1Password, Google Authenticator, Authy, Bitwarden — any app for six-digit codes.
                  </p>
                  <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
                    {/* Drawn on the server, from data that never leaves it. Inline on purpose. */}
                    <div
                      className="w-fit shrink-0 rounded-xl border border-border bg-white p-2"
                      dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
                    />
                    <div className="min-w-0 space-y-2 text-muted-foreground">
                      <p>Can't scan it? Type this key into the app instead:</p>
                      <p className="font-mono text-base break-all text-foreground select-all">
                        {grouped(setup.secret)}
                      </p>
                      <p>
                        On your phone already?{" "}
                        <a href={setup.uri} className="font-medium text-primary hover:underline">
                          Open it in your authenticator app
                        </a>
                        .
                      </p>
                    </div>
                  </div>
                </li>
                <li>
                  <p className="font-medium">2. Enter the code the app shows</p>
                  <div className="mt-3 max-w-xs">
                    <TextField
                      label="Code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={7}
                      placeholder="123456"
                      className="font-mono tracking-[0.3em]"
                      value={confirm.data.code}
                      error={confirm.errors.code}
                      onChange={(e) => confirm.setData("code", e.target.value)}
                      required
                    />
                  </div>
                </li>
              </ol>
            </CardBody>
            <CardFooter>
              <Button
                variant="ghost"
                onClick={() => router.delete(route("settings.two-factor.destroy"), { preserveScroll: true })}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={confirm.processing}>
                {confirm.processing ? "Checking…" : "Turn on"}
              </Button>
            </CardFooter>
          </form>
        ) : (
          <>
            <CardBody className="text-sm text-muted-foreground">
              Even with your password, nobody can sign in without your phone. You'll get recovery
              codes for the day you don't have it.
            </CardBody>
            <CardFooter>
              <Button
                onClick={() =>
                  router.post(route("settings.two-factor.store"), {}, { preserveScroll: true })
                }
              >
                Set up two-factor
              </Button>
            </CardFooter>
          </>
        )}
      </Card>

      <Modal
        open={disabling}
        onClose={() => setDisabling(false)}
        title="Turn off two-factor?"
        description="Signing in will need only your password. Your recovery codes stop working."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisabling(false)}>
              Keep it on
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                router.delete(route("settings.two-factor.destroy"), {
                  preserveScroll: true,
                  onFinish: () => setDisabling(false),
                })
              }
            >
              Turn off
            </Button>
          </>
        }
      />
    </>
  );
}

TwoFactor.layout = (page: ReactNode) => <SettingsLayout>{page}</SettingsLayout>;

export default TwoFactor;
