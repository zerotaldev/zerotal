<script setup lang="ts">
import { ref } from "vue";
import { Head } from "@inertiajs/vue3";
import SettingsLayout from "../../Layouts/SettingsLayout.vue";
import Button from "../../Components/Button.vue";
import Card from "../../Components/Card.vue";
import CardHeader from "../../Components/CardHeader.vue";
import PasswordDialog from "../../Components/PasswordDialog.vue";

defineOptions({ layout: SettingsLayout });
defineProps<{ title: string }>();

const confirming = ref(false);
</script>

<template>
  <Head :title="title" />

  <Card class="border-destructive/40">
    <CardHeader
      title="Delete account"
      description="Your account and everything in it — projects, passkeys, sessions — is removed for good. There is no undo."
    />
    <div
      class="mt-5 flex justify-end rounded-b-xl border-t border-destructive/20 bg-destructive/5 px-5 py-3 sm:px-6"
    >
      <Button variant="danger" @click="confirming = true">Delete my account</Button>
    </div>
  </Card>

  <PasswordDialog
    :open="confirming"
    title="Delete your account?"
    description="This cannot be undone. Enter your password to confirm."
    method="delete"
    :url="route('settings.delete-account.destroy')"
    confirm-label="Delete account"
    busy-label="Deleting…"
    @close="confirming = false"
  />
</template>
