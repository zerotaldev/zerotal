<script setup lang="ts">
/**
 * A dialog that asks for the password before doing something that cannot be taken back
 * — deleting the account, signing out every other device. The password goes to the
 * server with the request, and a wrong one comes back as a field error here.
 */
import { useForm } from "@inertiajs/vue3";
import Button from "./Button.vue";
import Modal from "./Modal.vue";
import TextField from "./TextField.vue";
import type { ButtonVariant } from "../lib/button";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string | undefined;
    method: "post" | "delete";
    url: string;
    confirmLabel: string;
    /** Describes the button while the request is in flight. */
    busyLabel: string;
    variant?: ButtonVariant | undefined;
  }>(),
  { variant: "danger" },
);
const emit = defineEmits<{ close: [] }>();

const form = useForm({ password: "" });

function close() {
  form.reset();
  form.clearErrors();
  emit("close");
}

function submit() {
  form.submit(props.method, props.url, {
    preserveScroll: true,
    onSuccess: () => close(),
    onFinish: () => form.reset(),
  });
}
</script>

<template>
  <Modal :open="open" :title="title" :description="description" @close="close">
    <form class="space-y-5" @submit.prevent="submit">
      <TextField
        v-model="form.password"
        label="Password"
        type="password"
        autocomplete="current-password"
        autofocus
        :error="form.errors.password"
        required
      />
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" @click="close">Cancel</Button>
        <Button type="submit" :variant="variant" :disabled="form.processing">
          {{ form.processing ? busyLabel : confirmLabel }}
        </Button>
      </div>
    </form>
  </Modal>
</template>
