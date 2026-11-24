<script setup lang="ts">
import { Head, useForm, usePage } from "@inertiajs/vue3";
import SettingsLayout from "../../Layouts/SettingsLayout.vue";
import Alert from "../../Components/Alert.vue";
import Button from "../../Components/Button.vue";
import Card from "../../Components/Card.vue";
import CardBody from "../../Components/CardBody.vue";
import CardFooter from "../../Components/CardFooter.vue";
import CardHeader from "../../Components/CardHeader.vue";
import TextField from "../../Components/TextField.vue";
import type { SharedProps } from "../../types";

defineOptions({ layout: SettingsLayout });
defineProps<{ title: string; emailVerified: boolean }>();

const user = usePage<SharedProps>().props.auth.user;
const form = useForm({ name: user?.name ?? "", email: user?.email ?? "" });
const resend = useForm({});
</script>

<template>
  <Head :title="title" />

  <Alert v-if="!emailVerified" tone="warning" title="Your email address is not confirmed yet">
    Until it is, the dashboard and projects stay locked. Check your inbox for the link.
    <template #actions>
      <Button
        size="sm"
        variant="secondary"
        :disabled="resend.processing"
        @click="resend.post(route('verify-email.store'), { preserveScroll: true })"
      >
        Send the link again
      </Button>
    </template>
  </Alert>

  <Card>
    <form @submit.prevent="form.patch(route('settings.profile.update'), { preserveScroll: true })">
      <CardHeader title="Profile" description="Your name, and the address we email." />
      <CardBody class="space-y-5">
        <TextField
          v-model="form.name"
          label="Name"
          autocomplete="name"
          :error="form.errors.name"
          required
        />
        <TextField
          v-model="form.email"
          label="Email"
          type="email"
          autocomplete="email"
          hint="Changing it sends a link to the new address to confirm it."
          :error="form.errors.email"
          required
        />
      </CardBody>
      <CardFooter>
        <Button type="submit" :disabled="form.processing || !form.isDirty">
          {{ form.processing ? "Saving…" : "Save" }}
        </Button>
      </CardFooter>
    </form>
  </Card>
</template>
