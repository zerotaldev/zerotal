<script setup lang="ts">
import { Head, Link, useForm } from "@inertiajs/vue3";
import AuthLayout from "../../Layouts/AuthLayout.vue";
import Button from "../../Components/Button.vue";
import Icon from "../../Components/Icon.vue";

defineProps<{
  title: string;
  email: string;
  /** Mail is printed by the server rather than sent (MAIL_DRIVER=log). */
  mailIsLogged: boolean;
}>();

const resend = useForm({});
</script>

<template>
  <Head :title="title" />

  <AuthLayout title="Check your inbox" description="One more step: confirm your email address.">
    <div class="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
      <Icon name="mail" class="mt-0.5 size-5 shrink-0 text-primary" />
      <p class="text-sm text-muted-foreground">
        We sent a link to <span class="font-medium text-foreground">{{ email }}</span>. Open it on
        this device to confirm the address. The link expires in an hour.
      </p>
    </div>

    <p v-if="mailIsLogged" class="mt-4 text-sm text-muted-foreground">
      Working locally? The mail driver is <code class="font-mono text-foreground">log</code>, so the
      message — link included — is printed in the terminal running the server.
    </p>

    <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button :disabled="resend.processing" @click="resend.post(route('verify-email.store'))">
        {{ resend.processing ? "Sending…" : "Send the link again" }}
      </Button>
      <Link
        :href="route('settings.profile')"
        class="text-sm font-medium text-primary hover:underline"
      >
        Wrong address? Change it
      </Link>
    </div>

    <template #footer>
      <Link
        :href="route('logout.store')"
        method="post"
        as="button"
        class="font-medium text-primary hover:underline"
      >
        Sign out
      </Link>
    </template>
  </AuthLayout>
</template>
