import { useState, type FormEvent, type ReactNode } from "react";
import { Head, router } from "@inertiajs/react";
import SettingsLayout from "../../Layouts/SettingsLayout";
import { Alert } from "../../Components/Alert";
import { Badge } from "../../Components/Badge";
import { Button } from "../../Components/Button";
import { Card, CardHeader } from "../../Components/Card";
import { EmptyState } from "../../Components/EmptyState";
import { TextField } from "../../Components/Field";
import { FingerprintIcon, PlusIcon } from "../../Components/Icons";
import { Modal } from "../../Components/Modal";
import { toast } from "../../Components/Toasts";
import { formatDate, timeAgo } from "../../lib/format";
import { postJson } from "../../lib/http";
import { createPasskey, passkeysSupported, wasCancelled } from "../../lib/passkeys";

interface Passkey {
  id: number;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

interface Props {
  title: string;
  passkeys: Passkey[];
}

/** A name to suggest for a new passkey, from what this browser says it is running on. */
function suggestedName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Passkey";
}

function Passkeys({ title, passkeys }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const supported = passkeysSupported();

  function openAdd() {
    setName(suggestedName());
    setAdding(true);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const options = await postJson<Parameters<typeof createPasskey>[0]>(
        route("settings.passkeys.options.store"),
      );
      if (!options.ok) throw new Error("Could not start adding a passkey. Reload and try again.");
      const credential = await createPasskey(options.data);
      const saved = await postJson<{ message?: string }>(route("settings.passkeys.store"), {
        name,
        credential,
      });
      if (!saved.ok) throw new Error(saved.data.message ?? "That passkey could not be saved.");
      setAdding(false);
      router.reload();
    } catch (error) {
      if (!wasCancelled(error)) toast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head title={title} />

      {!supported ? (
        <Alert tone="warning" title="This browser can't use passkeys">
          Try a recent version of Chrome, Safari, Edge or Firefox.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Passkeys"
          description="Sign in with your fingerprint, face or device PIN instead of a password."
          actions={
            passkeys.length > 0 ? (
              <Button size="sm" onClick={openAdd} disabled={!supported}>
                <PlusIcon className="size-4" />
                Add a passkey
              </Button>
            ) : null
          }
        />

        <div className="p-5 sm:p-6">
          {passkeys.length === 0 ? (
            <EmptyState
              icon={FingerprintIcon}
              title="No passkeys yet"
              description="A passkey lives on your phone, laptop or security key. Nothing to remember, nothing to type."
              action={
                <Button onClick={openAdd} disabled={!supported}>
                  <PlusIcon className="size-4" />
                  Add a passkey
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="flex items-center gap-4 p-4">
                  <FingerprintIcon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {passkey.name}
                      {passkey.backedUp ? <Badge tone="primary">Synced</Badge> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Added {formatDate(passkey.createdAt)} · Last used {timeAgo(passkey.lastUsedAt)}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(passkey)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a passkey"
        description="Give it a name you'll recognise. Your browser will then ask you to confirm it's you."
      >
        <form onSubmit={add} className="space-y-5">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Waiting for your device…" : "Continue"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove “${removing?.name ?? ""}”?`}
        description="It will no longer sign you in. You can add it again later."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                removing &&
                router.delete(route("settings.passkeys.destroy", { passkey: removing.id }), {
                  preserveScroll: true,
                  onFinish: () => setRemoving(null),
                })
              }
            >
              Remove
            </Button>
          </>
        }
      />
    </>
  );
}

Passkeys.layout = (page: ReactNode) => <SettingsLayout>{page}</SettingsLayout>;

export default Passkeys;
