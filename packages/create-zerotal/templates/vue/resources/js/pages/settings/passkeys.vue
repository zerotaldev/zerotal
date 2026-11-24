<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Head, router } from "@inertiajs/vue3";
import SettingsLayout from "../../Layouts/SettingsLayout.vue";
import Alert from "../../Components/Alert.vue";
import Badge from "../../Components/Badge.vue";
import Button from "../../Components/Button.vue";
import Card from "../../Components/Card.vue";
import CardHeader from "../../Components/CardHeader.vue";
import EmptyState from "../../Components/EmptyState.vue";
import Icon from "../../Components/Icon.vue";
import Modal from "../../Components/Modal.vue";
import TextField from "../../Components/TextField.vue";
import { formatDate, timeAgo } from "../../lib/format";
import { postJson } from "../../lib/http";
import { createPasskey, passkeysSupported, wasCancelled } from "../../lib/passkeys";
import { toast } from "../../lib/toast";

defineOptions({ layout: SettingsLayout });

interface Passkey {
  id: number;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

defineProps<{ title: string; passkeys: Passkey[] }>();

const adding = ref(false);
const name = ref("");
const busy = ref(false);
const removing = ref<Passkey | null>(null);
// Checked once mounted: the server render has no `window`.
const supported = ref(true);
onMounted(() => (supported.value = passkeysSupported()));

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

function openAdd() {
  name.value = suggestedName();
  adding.value = true;
}

async function add() {
  busy.value = true;
  try {
    const options = await postJson<Parameters<typeof createPasskey>[0]>(
      route("settings.passkeys.options.store"),
    );
    if (!options.ok) throw new Error("Could not start adding a passkey. Reload and try again.");
    const credential = await createPasskey(options.data);
    const saved = await postJson<{ message?: string }>(route("settings.passkeys.store"), {
      name: name.value,
      credential,
    });
    if (!saved.ok) throw new Error(saved.data.message ?? "That passkey could not be saved.");
    adding.value = false;
    router.reload();
  } catch (error) {
    if (!wasCancelled(error))
      toast("error", error instanceof Error ? error.message : String(error));
  } finally {
    busy.value = false;
  }
}

function remove() {
  if (!removing.value) return;
  router.delete(route("settings.passkeys.destroy", { passkey: removing.value.id }), {
    preserveScroll: true,
    onFinish: () => (removing.value = null),
  });
}
</script>

<template>
  <Head :title="title" />

  <Alert v-if="!supported" tone="warning" title="This browser can't use passkeys">
    Try a recent version of Chrome, Safari, Edge or Firefox.
  </Alert>

  <Card>
    <CardHeader
      title="Passkeys"
      description="Sign in with your fingerprint, face or device PIN instead of a password."
    >
      <template v-if="passkeys.length > 0" #actions>
        <Button size="sm" :disabled="!supported" @click="openAdd">
          <Icon name="plus" class="size-4" />
          Add a passkey
        </Button>
      </template>
    </CardHeader>

    <div class="p-5 sm:p-6">
      <EmptyState
        v-if="passkeys.length === 0"
        icon="fingerprint"
        title="No passkeys yet"
        description="A passkey lives on your phone, laptop or security key. Nothing to remember, nothing to type."
      >
        <template #action>
          <Button :disabled="!supported" @click="openAdd">
            <Icon name="plus" class="size-4" />
            Add a passkey
          </Button>
        </template>
      </EmptyState>

      <ul v-else class="divide-y divide-border rounded-xl border border-border">
        <li v-for="passkey in passkeys" :key="passkey.id" class="flex items-center gap-4 p-4">
          <Icon name="fingerprint" class="size-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
              {{ passkey.name }}
              <Badge v-if="passkey.backedUp" tone="primary">Synced</Badge>
            </p>
            <p class="text-sm text-muted-foreground">
              Added {{ formatDate(passkey.createdAt) }} · Last used
              {{ timeAgo(passkey.lastUsedAt) }}
            </p>
          </div>
          <Button size="sm" variant="ghost" @click="removing = passkey">Remove</Button>
        </li>
      </ul>
    </div>
  </Card>

  <Modal
    :open="adding"
    title="Add a passkey"
    description="Give it a name you'll recognise. Your browser will then ask you to confirm it's you."
    @close="adding = false"
  >
    <form class="space-y-5" @submit.prevent="add">
      <TextField v-model="name" label="Name" maxlength="60" required />
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" @click="adding = false">Cancel</Button>
        <Button type="submit" :disabled="busy">
          {{ busy ? "Waiting for your device…" : "Continue" }}
        </Button>
      </div>
    </form>
  </Modal>

  <Modal
    :open="removing !== null"
    :title="`Remove “${removing?.name ?? ''}”?`"
    description="It will no longer sign you in. You can add it again later."
    @close="removing = null"
  >
    <template #footer>
      <Button variant="secondary" @click="removing = null">Cancel</Button>
      <Button variant="danger" @click="remove">Remove</Button>
    </template>
  </Modal>
</template>
