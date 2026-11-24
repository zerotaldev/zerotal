<script setup lang="ts">
/**
 * A working form, end to end.
 *
 * Worth reading as a pattern rather than as content: the browser posts, the
 * server validates, and a failure comes back as a redirect carrying `errors`
 * and `old`. There is no client-side validation to keep in step with the
 * server's rules, and no fetch/loading/error state to hand-roll — `useForm`
 * exposes `processing` and reads the error bag off the page props.
 *
 * The matching route is app/routes/contact.ts.
 */
import { Head, useForm } from "@inertiajs/vue3";
import PublicLayout from "../Layouts/PublicLayout.vue";
import Button from "../Components/Button.vue";
import Card from "../Components/Card.vue";
import Code from "../Components/Code.vue";
import Icon from "../Components/Icon.vue";
import TextAreaField from "../Components/TextAreaField.vue";
import TextField from "../Components/TextField.vue";

defineOptions({ layout: PublicLayout });

defineProps<{
  title: string;
}>();

const form = useForm({ name: "", email: "", message: "" });

function submit() {
  // A success clears the fields; a failure leaves them, with the errors beside them.
  form.post(route("contact.store"), { onSuccess: () => form.reset() });
}
</script>

<template>
  <Head :title="title" />

  <div class="mx-auto max-w-4xl">
    <header class="max-w-2xl">
      <p class="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">Say hello</p>
      <h1 class="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {{ title }}
      </h1>
      <p class="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">
        Submit it empty, or with a malformed address, and watch the server send the errors and your
        input straight back.
      </p>
    </header>

    <div class="mt-12 grid gap-6 lg:grid-cols-5">
      <Card class="p-6 sm:p-8 lg:col-span-3">
        <form class="space-y-5" novalidate @submit.prevent="submit">
          <TextField
            v-model="form.name"
            label="Name"
            name="name"
            :error="form.errors.name"
            autocomplete="name"
            placeholder="Ada Lovelace"
          />

          <TextField
            v-model="form.email"
            label="Email"
            name="email"
            type="email"
            :error="form.errors.email"
            autocomplete="email"
            placeholder="ada@example.com"
          />

          <TextAreaField
            v-model="form.message"
            label="Message"
            name="message"
            :error="form.errors.message"
            hint="At least 10 characters."
            placeholder="What's on your mind?"
          />

          <div class="flex items-center gap-3 pt-1">
            <Button type="submit" :disabled="form.processing">
              <span
                v-if="form.processing"
                aria-hidden="true"
                class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              {{ form.processing ? "Sending…" : "Send message" }}
            </Button>
            <p class="text-sm text-muted-foreground">Nothing is stored — see the route.</p>
          </div>
        </form>
      </Card>

      <div class="space-y-6 lg:col-span-2">
        <Card class="p-6">
          <h2 class="font-semibold text-card-foreground">What happens on submit</h2>
          <ol class="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <li>
              <span class="font-medium text-foreground">1.</span> The POST reaches
              <Code>app/routes/contact.ts</Code>.
            </li>
            <li>
              <span class="font-medium text-foreground">2.</span> <Code>validate()</Code> checks the
              body and returns typed data.
            </li>
            <li>
              <span class="font-medium text-foreground">3.</span> If it fails, errors and input are
              flashed and you are redirected back.
            </li>
            <li>
              <span class="font-medium text-foreground">4.</span> If it passes, a success flash
              becomes the toast in the corner.
            </li>
          </ol>
        </Card>

        <Card class="p-6">
          <h2 class="font-semibold text-card-foreground">Prefer email?</h2>
          <a
            href="mailto:hello@example.com"
            class="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary transition-opacity hover:opacity-80"
          >
            <Icon name="mail" class="size-4" />
            hello@example.com
          </a>
        </Card>
      </div>
    </div>
  </div>
</template>
