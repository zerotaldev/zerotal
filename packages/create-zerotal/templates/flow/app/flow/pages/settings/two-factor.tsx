import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { TwoFactor } from "zerotal/auth";
import { RECOVERY_CODES_FLASH, SETUP_SECRET_KEY } from "@app/auth/two-factor";
import { Alert } from "../../components/Alert";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../components/Card";
import { TextField } from "../../components/Field";
import { Modal } from "../../components/Modal";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { Page, titled } from "../../lib/page";

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to type off a screen. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

function RecoveryCodes({ codes }: { codes: string[] }): HtmlNode {
  return (
    <Alert
      tone="warning"
      title="Save these recovery codes now"
      actions={
        <Button
          size="sm"
          variant="secondary"
          data-copy={codes.join("\n")}
          data-copied="Recovery codes copied."
        >
          Copy codes
        </Button>
      }
    >
      <p>
        Each one signs you in once if you lose your phone. Keep them in a password manager. They
        will not be shown again.
      </p>
      <ul class="mt-3 space-y-1 font-mono text-sm break-all text-foreground">
        {codes.map((code) => (
          <li data-recovery-code="">{code}</li>
        ))}
      </ul>
    </Alert>
  );
}

/**
 * GET /settings/two-factor.
 *
 * Turning it on takes two steps, so a half-finished setup can never lock anyone out:
 * "Set up two-factor" posts to app/routes/(auth)/settings/two-factor/index.ts, which
 * makes a secret and keeps it in the session while this page shows the QR code; only
 * /settings/two-factor/confirm, given a working code from the app, saves it to the user.
 */
export class TwoFactorPage extends Page {
  static override title = titled("Two-factor authentication");

  enabled = false;
  /** Present while setting up: the QR code, and the same secret as text and as a link. */
  setup: { qrSvg: string; uri: string; secret: string } | null = null;
  /** Present once, straight after codes are made. */
  recoveryCodes: string[] | null = null;
  recoveryCodesLeft = 0;

  override async onMount(): Promise<void> {
    const user = this.user;
    if (!user) return;
    this.enabled = user.hasTwoFactorEnabled();

    const pending = this.enabled ? undefined : this.http?.session?.get(SETUP_SECRET_KEY);
    // The QR code is drawn on the server as inline SVG — the secret is never sent to an
    // image service — and the secret is shown as text for typing in by hand.
    if (typeof pending === "string") {
      this.setup = {
        qrSvg: TwoFactor.getQrCodeSvg(user.email, pending, { size: 192 }),
        uri: TwoFactor.getQrCodeUrl(user.email, pending),
        secret: pending,
      };
    }
    // Shown once, straight after they are made, and never again.
    this.recoveryCodes =
      (this.http?.session?.get(RECOVERY_CODES_FLASH) as string[] | undefined) ?? null;
    this.recoveryCodesLeft = this.enabled ? user.recoveryCodeHashes().length : 0;
  }

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const { enabled, setup, recoveryCodes, recoveryCodesLeft } = this;

    return (
      <>
        {recoveryCodes ? <RecoveryCodes codes={recoveryCodes} /> : null}

        <Card>
          <CardHeader
            title="Two-factor authentication"
            description="Ask for a code from your phone, as well as your password, when you sign in."
            actions={
              <span data-two-factor-status="">
                {enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
              </span>
            }
          />

          {enabled ? (
            <>
              <CardBody class="space-y-2 text-sm text-muted-foreground">
                <p>
                  Signing in asks for the six-digit code from your authenticator app. You have{" "}
                  <span class="font-medium text-foreground">{recoveryCodesLeft}</span> unused
                  recovery code{recoveryCodesLeft === 1 ? "" : "s"} for when your phone is not to
                  hand.
                </p>
              </CardBody>
              <CardFooter class="justify-between">
                <form method="post" action={route("settings.two-factor.recovery-codes.store")}>
                  <Button type="submit" variant="secondary">
                    Make new recovery codes
                  </Button>
                </form>
                <Button variant="danger" data-open-modal="turn-off-two-factor">
                  Turn off
                </Button>
              </CardFooter>
            </>
          ) : setup ? (
            <form method="post" action={route("settings.two-factor.confirm.store")}>
              <CardBody class="space-y-6">
                <ol class="space-y-6 text-sm">
                  <li>
                    <p class="font-medium">1. Scan this with your authenticator app</p>
                    <p class="mt-1 text-muted-foreground">
                      1Password, Google Authenticator, Authy, Bitwarden — any app for six-digit
                      codes.
                    </p>
                    <div class="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
                      {/* Drawn on the server, from data that never leaves it. Inline on purpose. */}
                      <div
                        class="w-fit shrink-0 rounded-xl border border-border bg-white p-2"
                        dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
                      />
                      <div class="min-w-0 space-y-2 text-muted-foreground">
                        <p>Can't scan it? Type this key into the app instead:</p>
                        <p
                          class="font-mono text-base break-all text-foreground select-all"
                          data-two-factor-secret=""
                        >
                          {grouped(setup.secret)}
                        </p>
                        <p>
                          On your phone already?{" "}
                          <a href={setup.uri} class="font-medium text-primary hover:underline">
                            Open it in your authenticator app
                          </a>
                          .
                        </p>
                      </div>
                    </div>
                  </li>
                  <li>
                    <p class="font-medium">2. Enter the code the app shows</p>
                    <div class="mt-3 max-w-xs">
                      <TextField
                        label="Code"
                        name="code"
                        inputmode="numeric"
                        autocomplete="one-time-code"
                        maxlength="7"
                        placeholder="123456"
                        class="font-mono tracking-[0.3em]"
                        error={this.error("code")}
                        required
                      />
                    </div>
                  </li>
                </ol>
              </CardBody>
              <CardFooter>
                {/* Abandons the setup: the same DELETE as turning it off. */}
                <Button
                  type="submit"
                  variant="ghost"
                  formaction={route("settings.two-factor.destroy")}
                  formnovalidate
                  data-method="delete"
                >
                  Cancel
                </Button>
                <Button type="submit" data-loading-text="Checking…">
                  Turn on
                </Button>
              </CardFooter>
            </form>
          ) : (
            <>
              <CardBody class="text-sm text-muted-foreground">
                Even with your password, nobody can sign in without your phone. You'll get recovery
                codes for the day you don't have it.
              </CardBody>
              <CardFooter>
                <form method="post" action={route("settings.two-factor.store")}>
                  <Button type="submit">Set up two-factor</Button>
                </form>
              </CardFooter>
            </>
          )}
        </Card>

        <Modal
          id="turn-off-two-factor"
          title="Turn off two-factor?"
          description="Signing in will need only your password. Your recovery codes stop working."
          footer={
            <>
              <Button variant="secondary" data-close-modal="">
                Keep it on
              </Button>
              {/* DELETE, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
              <form
                method="post"
                action={route("settings.two-factor.destroy")}
                data-method="delete"
              >
                <Button
                  type="submit"
                  variant="danger"
                  class="w-full"
                  data-loading-text="Turning off…"
                >
                  Turn off
                </Button>
              </form>
            </>
          }
        />
      </>
    );
  }
}
