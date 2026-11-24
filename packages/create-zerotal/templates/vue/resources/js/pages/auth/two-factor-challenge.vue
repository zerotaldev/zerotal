<script setup lang="ts">
import { ref } from "vue";
import { Head, Link, useForm } from "@inertiajs/vue3";
import AuthLayout from "../../Layouts/AuthLayout.vue";
import Button from "../../Components/Button.vue";
import TextField from "../../Components/TextField.vue";

defineProps<{ title: string }>();

// A lost phone is what recovery codes are for, so the form offers both.
const useRecoveryCode = ref(false);
const form = useForm({ code: "", recovery_code: "" });

function submit() {
  form
    .transform((data) =>
      useRecoveryCode.value ? { recovery_code: data.recovery_code } : { code: data.code },
    )
    .post(route("two-factor.challenge.store"), { onFinish: () => form.reset() });
}

function toggle() {
  useRecoveryCode.value = !useRecoveryCode.value;
  form.clearErrors();
  form.reset();
}
</script>

<template>
  <Head :title="title" />

  <AuthLayout
    title="Two-factor authentication"
    description="Enter the six-digit code from your authenticator app."
  >
    <form class="space-y-5" @submit.prevent="submit">
      <TextField
        v-if="useRecoveryCode"
        key="recovery"
        v-model="form.recovery_code"
        label="Recovery code"
        autocomplete="off"
        autofocus
        spellcheck="false"
        hint="One of the codes you saved when you turned two-factor on. Each works once."
        :error="form.errors.recovery_code"
        required
      />
      <TextField
        v-else
        key="code"
        v-model="form.code"
        label="Authentication code"
        inputmode="numeric"
        autocomplete="one-time-code"
        autofocus
        maxlength="7"
        placeholder="123456"
        class="text-center font-mono text-lg tracking-[0.4em]"
        :error="form.errors.code"
        required
      />

      <Button type="submit" class="w-full" :disabled="form.processing">
        {{ form.processing ? "Checking…" : "Continue" }}
      </Button>

      <button
        type="button"
        class="w-full text-center text-sm font-medium text-primary hover:underline"
        @click="toggle"
      >
        {{
          useRecoveryCode
            ? "Use a code from my app instead"
            : "Lost your phone? Use a recovery code"
        }}
      </button>
    </form>

    <template #footer>
      <Link :href="route('login')" class="font-medium text-primary hover:underline">
        Sign in as someone else
      </Link>
    </template>
  </AuthLayout>
</template>
