<script setup lang="ts">
import { Head, router, useForm, usePage } from "@inertiajs/vue3";
import AppLayout from "../Layouts/AppLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import TextField from "../Components/TextField.vue";
import type { SharedProps } from "../types";

defineOptions({ layout: AppLayout });
defineProps<{ title: string }>();

// `auth.user` is shared into every page by @zerotal/inertia, so this route does
// not have to pass the signed-in user as a prop.
const auth = usePage<SharedProps>().props.auth;

const details = useForm({
  name: auth.user?.name ?? "",
  email: auth.user?.email ?? "",
});

const password = useForm({
  current_password: "",
  password: "",
  password_confirmation: "",
});

function changePassword(): void {
  // Clear the fields whichever way it goes — a failed attempt should not leave
  // the old password sitting in the DOM.
  password.post("/profile/password", {
    preserveScroll: true,
    onFinish: () => password.reset(),
  });
}
</script>

<template>
  <Head :title="title" />

  <div class="mx-auto max-w-2xl space-y-6">
    <header>
      <h1 class="text-3xl font-bold tracking-tight text-balance">{{ title }}</h1>
      <p class="mt-2 text-muted-foreground">Update your details or change your password.</p>
    </header>

    <Card class="p-6 sm:p-8">
      <h2 class="text-lg font-semibold">Details</h2>

      <form
        class="mt-4 space-y-5"
        @submit.prevent="details.post('/profile', { preserveScroll: true })"
      >
        <TextField
          v-model="details.name"
          label="Name"
          autocomplete="name"
          :error="details.errors.name"
          required
        />
        <TextField
          v-model="details.email"
          label="Email"
          type="email"
          autocomplete="email"
          :error="details.errors.email"
          required
        />

        <Button type="submit" :disabled="details.processing">
          {{ details.processing ? "Saving…" : "Save details" }}
        </Button>
      </form>
    </Card>

    <Card class="p-6 sm:p-8">
      <h2 class="text-lg font-semibold">Password</h2>

      <form class="mt-4 space-y-5" @submit.prevent="changePassword">
        <TextField
          v-model="password.current_password"
          label="Current password"
          type="password"
          autocomplete="current-password"
          :error="password.errors.current_password"
          required
        />
        <TextField
          v-model="password.password"
          label="New password"
          type="password"
          autocomplete="new-password"
          hint="At least 8 characters."
          :error="password.errors.password"
          required
        />
        <TextField
          v-model="password.password_confirmation"
          label="Confirm new password"
          type="password"
          autocomplete="new-password"
          :error="password.errors.password_confirmation"
          required
        />

        <Button type="submit" :disabled="password.processing">
          {{ password.processing ? "Updating…" : "Change password" }}
        </Button>
      </form>
    </Card>

    <Card class="p-6 sm:p-8">
      <h2 class="text-lg font-semibold">Session</h2>
      <p class="mt-1 text-sm text-muted-foreground">Sign out of this browser.</p>
      <Button type="button" variant="secondary" class="mt-4" @click="router.post('/logout')">
        Sign out
      </Button>
    </Card>
  </div>
</template>
