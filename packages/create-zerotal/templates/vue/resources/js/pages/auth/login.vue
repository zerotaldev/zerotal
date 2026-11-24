<script setup lang="ts">
import { ref } from "vue";
import { Head, Link, router, useForm } from "@inertiajs/vue3";
import AuthLayout from "../../Layouts/AuthLayout.vue";
import Button from "../../Components/Button.vue";
import Checkbox from "../../Components/Checkbox.vue";
import Divider from "../../Components/Divider.vue";
import Icon from "../../Components/Icon.vue";
import SocialButtons from "../../Components/SocialButtons.vue";
import TextField from "../../Components/TextField.vue";
import { postJson } from "../../lib/http";
import { getPasskey, passkeysSupported, wasCancelled } from "../../lib/passkeys";
import { toast } from "../../lib/toast";

const props = defineProps<{
  title: string;
  /** Passkey sign-in is on (PASSKEY_RP_ID is set). */
  passkeys: boolean;
  /** Social providers switched on in config/social.ts. */
  providers: string[];
}>();

const form = useForm({ email: "", password: "", remember: false });
const passkeyBusy = ref(false);
// Checked in the browser only: the server render has no `window`.
const offerPasskey = ref(false);
if (typeof window !== "undefined") offerPasskey.value = props.passkeys && passkeysSupported();

function submit() {
  // The password is cleared whichever way it goes, so it never sits in the DOM.
  form.post(route("login.store"), { onFinish: () => form.reset("password") });
}

async function signInWithPasskey() {
  passkeyBusy.value = true;
  try {
    const options = await postJson<Parameters<typeof getPasskey>[0]>("/passkeys/login/options");
    if (!options.ok) throw new Error("Passkey sign-in is not available right now.");
    const assertion = await getPasskey(options.data);
    const result = await postJson<{ redirect?: string; message?: string }>(
      "/passkeys/login",
      assertion,
    );
    if (!result.ok || !result.data.redirect) {
      throw new Error(result.data.message ?? "That passkey did not work.");
    }
    router.visit(result.data.redirect);
  } catch (error) {
    if (!wasCancelled(error))
      toast("error", error instanceof Error ? error.message : String(error));
  } finally {
    passkeyBusy.value = false;
  }
}
</script>

<template>
  <Head :title="title" />

  <AuthLayout
    title="Sign in to your account"
    description="Welcome back. Enter your details to continue."
  >
    <div v-if="offerPasskey || providers.length > 0" class="mb-6 space-y-3">
      <Button
        v-if="offerPasskey"
        variant="secondary"
        class="w-full"
        :disabled="passkeyBusy"
        @click="signInWithPasskey"
      >
        <Icon name="fingerprint" class="size-4.5" />
        {{ passkeyBusy ? "Waiting for your passkey…" : "Sign in with a passkey" }}
      </Button>
      <SocialButtons :providers="providers" />
      <div class="pt-3"><Divider label="or with email" /></div>
    </div>

    <form class="space-y-5" @submit.prevent="submit">
      <TextField
        v-model="form.email"
        label="Email"
        type="email"
        :autocomplete="passkeys ? 'username webauthn' : 'username'"
        autofocus
        :error="form.errors.email"
        required
      />

      <TextField
        v-model="form.password"
        label="Password"
        type="password"
        autocomplete="current-password"
        :error="form.errors.password"
        required
      >
        <template #aside>
          <Link
            :href="route('forgot-password')"
            class="text-sm font-medium text-primary hover:underline"
          >
            Forgot password?
          </Link>
        </template>
      </TextField>

      <Checkbox v-model="form.remember" label="Keep me signed in" />

      <Button type="submit" class="w-full" :disabled="form.processing">
        {{ form.processing ? "Signing in…" : "Sign in" }}
      </Button>
    </form>

    <template #footer>
      New here?
      <Link :href="route('register')" class="font-medium text-primary hover:underline">
        Create an account
      </Link>
    </template>
  </AuthLayout>
</template>
