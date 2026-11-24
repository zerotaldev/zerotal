<script setup lang="ts">
import { Head, useForm } from "@inertiajs/vue3";
import SettingsLayout from "../../Layouts/SettingsLayout.vue";
import Button from "../../Components/Button.vue";
import Card from "../../Components/Card.vue";
import CardBody from "../../Components/CardBody.vue";
import CardFooter from "../../Components/CardFooter.vue";
import CardHeader from "../../Components/CardHeader.vue";
import TextField from "../../Components/TextField.vue";

defineOptions({ layout: SettingsLayout });
defineProps<{ title: string }>();

const form = useForm({ current_password: "", password: "", password_confirmation: "" });

function submit() {
  // Cleared whichever way it goes, so no password is left sitting in the DOM.
  form.put(route("settings.password.update"), {
    preserveScroll: true,
    onFinish: () => form.reset(),
  });
}
</script>

<template>
  <Head :title="title" />

  <Card>
    <form @submit.prevent="submit">
      <CardHeader
        title="Change password"
        description="Changing it signs you out on every other device."
      />
      <CardBody class="space-y-5">
        <TextField
          v-model="form.current_password"
          label="Current password"
          type="password"
          autocomplete="current-password"
          :error="form.errors.current_password"
          required
        />
        <TextField
          v-model="form.password"
          label="New password"
          type="password"
          autocomplete="new-password"
          hint="At least 8 characters."
          :error="form.errors.password"
          required
        />
        <TextField
          v-model="form.password_confirmation"
          label="Confirm new password"
          type="password"
          autocomplete="new-password"
          :error="form.errors.password_confirmation"
          required
        />
      </CardBody>
      <CardFooter>
        <Button type="submit" :disabled="form.processing">
          {{ form.processing ? "Saving…" : "Change password" }}
        </Button>
      </CardFooter>
    </form>
  </Card>
</template>
