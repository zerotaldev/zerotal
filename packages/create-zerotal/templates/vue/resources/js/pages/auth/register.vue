<script setup lang="ts">
import { Head, Link, useForm } from "@inertiajs/vue3";
import AuthLayout from "../../Layouts/AuthLayout.vue";
import Button from "../../Components/Button.vue";
import Divider from "../../Components/Divider.vue";
import SocialButtons from "../../Components/SocialButtons.vue";
import TextField from "../../Components/TextField.vue";

defineProps<{
  title: string;
  /** Social providers switched on in config/social.ts. */
  providers: string[];
}>();

const form = useForm({ name: "", email: "", password: "", password_confirmation: "" });

function submit() {
  form.post(route("register.store"), {
    onFinish: () => form.reset("password", "password_confirmation"),
  });
}
</script>

<template>
  <Head :title="title" />

  <AuthLayout title="Create an account" description="It takes about ten seconds.">
    <div v-if="providers.length > 0" class="mb-6 space-y-3">
      <SocialButtons :providers="providers" />
      <div class="pt-3"><Divider label="or with email" /></div>
    </div>

    <form class="space-y-5" @submit.prevent="submit">
      <TextField
        v-model="form.name"
        label="Name"
        autocomplete="name"
        autofocus
        :error="form.errors.name"
        required
      />
      <TextField
        v-model="form.email"
        label="Email"
        type="email"
        autocomplete="email"
        :error="form.errors.email"
        required
      />
      <TextField
        v-model="form.password"
        label="Password"
        type="password"
        autocomplete="new-password"
        hint="At least 8 characters."
        :error="form.errors.password"
        required
      />
      <TextField
        v-model="form.password_confirmation"
        label="Confirm password"
        type="password"
        autocomplete="new-password"
        :error="form.errors.password_confirmation"
        required
      />

      <Button type="submit" class="w-full" :disabled="form.processing">
        {{ form.processing ? "Creating account…" : "Create account" }}
      </Button>
    </form>

    <template #footer>
      Already have an account?
      <Link :href="route('login')" class="font-medium text-primary hover:underline">Sign in</Link>
    </template>
  </AuthLayout>
</template>
