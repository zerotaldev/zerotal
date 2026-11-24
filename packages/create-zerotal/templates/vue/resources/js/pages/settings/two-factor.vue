<script setup lang="ts">
import { ref } from "vue";
import { Head, router, useForm } from "@inertiajs/vue3";
import SettingsLayout from "../../Layouts/SettingsLayout.vue";
import Alert from "../../Components/Alert.vue";
import Badge from "../../Components/Badge.vue";
import Button from "../../Components/Button.vue";
import Card from "../../Components/Card.vue";
import CardBody from "../../Components/CardBody.vue";
import CardFooter from "../../Components/CardFooter.vue";
import CardHeader from "../../Components/CardHeader.vue";
import Modal from "../../Components/Modal.vue";
import TextField from "../../Components/TextField.vue";
import { toast } from "../../lib/toast";

defineOptions({ layout: SettingsLayout });

const props = defineProps<{
  title: string;
  enabled: boolean;
  /** Present while setting up: the QR code, and the same secret as text and as a link. */
  setup: { qrSvg: string; uri: string; secret: string } | null;
  /** Present once, straight after codes are made. */
  recoveryCodes: string[] | null;
  recoveryCodesLeft: number;
}>();

const confirm = useForm({ code: "" });
const disabling = ref(false);

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to type off a screen. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

function confirmCode() {
  confirm.post(route("settings.two-factor.confirm.store"), {
    preserveScroll: true,
    onFinish: () => confirm.reset(),
  });
}

async function copyCodes() {
  try {
    await navigator.clipboard.writeText((props.recoveryCodes ?? []).join("\n"));
    toast("success", "Recovery codes copied.");
  } catch {
    toast("error", "Could not copy — select the codes and copy them yourself.");
  }
}

const post = (name: "settings.two-factor.store" | "settings.two-factor.recovery-codes.store") =>
  router.post(route(name), {}, { preserveScroll: true });

function turnOff() {
  router.delete(route("settings.two-factor.destroy"), {
    preserveScroll: true,
    onFinish: () => (disabling.value = false),
  });
}
</script>

<template>
  <Head :title="title" />

  <Alert v-if="recoveryCodes" tone="warning" title="Save these recovery codes now">
    <p>
      Each one signs you in once if you lose your phone. Keep them in a password manager. They will
      not be shown again.
    </p>
    <ul class="mt-3 space-y-1 font-mono text-sm break-all text-foreground">
      <li v-for="code in recoveryCodes" :key="code">{{ code }}</li>
    </ul>
    <template #actions>
      <Button size="sm" variant="secondary" @click="copyCodes">Copy codes</Button>
    </template>
  </Alert>

  <Card>
    <CardHeader
      title="Two-factor authentication"
      description="Ask for a code from your phone, as well as your password, when you sign in."
    >
      <template #actions>
        <Badge :tone="enabled ? 'success' : 'neutral'">{{ enabled ? "On" : "Off" }}</Badge>
      </template>
    </CardHeader>

    <template v-if="enabled">
      <CardBody class="text-sm text-muted-foreground">
        Signing in asks for the six-digit code from your authenticator app. You have
        <span class="font-medium text-foreground">{{ recoveryCodesLeft }}</span> unused recovery
        code{{ recoveryCodesLeft === 1 ? "" : "s" }} for when your phone is not to hand.
      </CardBody>
      <CardFooter class="justify-between">
        <Button variant="secondary" @click="post('settings.two-factor.recovery-codes.store')">
          Make new recovery codes
        </Button>
        <Button variant="danger" @click="disabling = true">Turn off</Button>
      </CardFooter>
    </template>

    <form v-else-if="setup" @submit.prevent="confirmCode">
      <CardBody>
        <ol class="space-y-6 text-sm">
          <li>
            <p class="font-medium">1. Scan this with your authenticator app</p>
            <p class="mt-1 text-muted-foreground">
              1Password, Google Authenticator, Authy, Bitwarden — any app for six-digit codes.
            </p>
            <div class="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
              <!-- Drawn on the server, from data that never leaves it. Inline on purpose. -->
              <div
                class="w-fit shrink-0 rounded-xl border border-border bg-white p-2"
                v-html="setup.qrSvg"
              />
              <div class="min-w-0 space-y-2 text-muted-foreground">
                <p>Can't scan it? Type this key into the app instead:</p>
                <p class="font-mono text-base break-all text-foreground select-all">
                  {{ grouped(setup.secret) }}
                </p>
                <p>
                  On your phone already?
                  <a :href="setup.uri" class="font-medium text-primary hover:underline">
                    Open it in your authenticator app</a
                  >.
                </p>
              </div>
            </div>
          </li>
          <li>
            <p class="font-medium">2. Enter the code the app shows</p>
            <div class="mt-3 max-w-xs">
              <TextField
                v-model="confirm.code"
                label="Code"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="7"
                placeholder="123456"
                class="font-mono tracking-[0.3em]"
                :error="confirm.errors.code"
                required
              />
            </div>
          </li>
        </ol>
      </CardBody>
      <CardFooter>
        <Button
          variant="ghost"
          @click="router.delete(route('settings.two-factor.destroy'), { preserveScroll: true })"
        >
          Cancel
        </Button>
        <Button type="submit" :disabled="confirm.processing">
          {{ confirm.processing ? "Checking…" : "Turn on" }}
        </Button>
      </CardFooter>
    </form>

    <template v-else>
      <CardBody class="text-sm text-muted-foreground">
        Even with your password, nobody can sign in without your phone. You'll get recovery codes
        for the day you don't have it.
      </CardBody>
      <CardFooter>
        <Button @click="post('settings.two-factor.store')">Set up two-factor</Button>
      </CardFooter>
    </template>
  </Card>

  <Modal
    :open="disabling"
    title="Turn off two-factor?"
    description="Signing in will need only your password. Your recovery codes stop working."
    @close="disabling = false"
  >
    <template #footer>
      <Button variant="secondary" @click="disabling = false">Keep it on</Button>
      <Button variant="danger" @click="turnOff">Turn off</Button>
    </template>
  </Modal>
</template>
