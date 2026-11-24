import { route } from "zerotal";
import type { HtmlNode } from "@zerotal/flow";
import { listPasskeys, type PasskeySummary } from "@app/auth/passkeys";
import { Alert } from "../../components/Alert";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { TextField } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { SettingsLayout } from "../../layouts/SettingsLayout";
import { formatDate, timeAgo } from "../../lib/format";
import { Page, titled } from "../../lib/page";

/**
 * GET /settings/passkeys — only when PASSKEY_RP_ID is set.
 *
 * Adding one is a ceremony between the browser and the server, so it is the browser
 * script's job (resources/js/lib/passkey-ui.ts): it asks app/routes/(auth)/settings/
 * passkeys/options.ts for a challenge, has the device make the passkey, and posts it to
 * app/routes/(auth)/settings/passkeys/index.ts. Removing one is an ordinary DELETE.
 */
export class PasskeysPage extends Page {
  static override title = titled("Passkeys");

  passkeys: PasskeySummary[] = [];

  override async onMount(): Promise<void> {
    if (this.user) this.passkeys = await listPasskeys(this.user.id);
  }

  override layout(page: HtmlNode): HtmlNode {
    return <SettingsLayout shell={this.shell()}>{page}</SettingsLayout>;
  }

  override async render(): Promise<HtmlNode> {
    const addButton = (size?: "sm") => (
      <Button size={size} data-open-modal="add-passkey" data-passkey-requires-support="">
        <Icon name="plus" class="size-4" />
        Add a passkey
      </Button>
    );

    return (
      <>
        <div data-passkey-unsupported="" hidden>
          <Alert tone="warning" title="This browser can't use passkeys">
            Try a recent version of Chrome, Safari, Edge or Firefox.
          </Alert>
        </div>

        <Card>
          <CardHeader
            title="Passkeys"
            description="Sign in with your fingerprint, face or device PIN instead of a password."
            actions={this.passkeys.length > 0 ? addButton("sm") : null}
          />

          <div class="p-5 sm:p-6">
            {this.passkeys.length === 0 ? (
              <EmptyState
                icon="fingerprint"
                title="No passkeys yet"
                description="A passkey lives on your phone, laptop or security key. Nothing to remember, nothing to type."
                action={addButton()}
              />
            ) : (
              <ul class="divide-y divide-border rounded-xl border border-border">
                {this.passkeys.map((passkey) => (
                  <li key={String(passkey.id)} class="flex items-center gap-4 p-4">
                    <Icon name="fingerprint" class="size-5 shrink-0 text-muted-foreground" />
                    <div class="min-w-0 flex-1">
                      <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {passkey.name}
                        {passkey.backedUp ? <Badge tone="primary">Synced</Badge> : null}
                      </p>
                      <p class="text-sm text-muted-foreground">
                        Added {formatDate(passkey.createdAt)} · Last used{" "}
                        {timeAgo(passkey.lastUsedAt)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-open-modal={`remove-passkey-${passkey.id}`}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Modal
          id="add-passkey"
          title="Add a passkey"
          description="Give it a name you'll recognise. Your browser will then ask you to confirm it's you."
        >
          <form data-passkey-register="" class="space-y-5">
            <TextField
              label="Name"
              name="name"
              id="passkey-name"
              maxlength="60"
              data-suggest-passkey-name=""
              required
            />
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" data-close-modal="">
                Cancel
              </Button>
              <Button type="submit">Continue</Button>
            </div>
          </form>
        </Modal>

        {this.passkeys.map((passkey) => (
          <Modal
            id={`remove-passkey-${passkey.id}`}
            title={`Remove “${passkey.name}”?`}
            description="It will no longer sign you in. You can add it again later."
            footer={
              <>
                <Button variant="secondary" data-close-modal="">
                  Cancel
                </Button>
                {/* DELETE, which a browser form can't send alone: see resources/js/lib/forms.ts. */}
                <form
                  method="post"
                  action={route("settings.passkeys.destroy", { passkey: passkey.id })}
                  data-method="delete"
                >
                  <Button
                    type="submit"
                    variant="danger"
                    class="w-full"
                    data-loading-text="Removing…"
                  >
                    Remove
                  </Button>
                </form>
              </>
            }
          />
        ))}
      </>
    );
  }
}
