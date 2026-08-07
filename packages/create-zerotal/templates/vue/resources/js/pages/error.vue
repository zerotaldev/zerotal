<script setup lang="ts">
/**
 * The page behind every HTTP error the app renders to a browser.
 *
 * `app/exceptions/Handler.ts` picks the status and renders this component, so a
 * missing URL lands inside the app's own shell instead of on a bare framework
 * page. In development the framework's stack-trace page still wins for 500s —
 * this is what production shows.
 */
import { computed } from "vue";
import { Head, Link } from "@inertiajs/vue3";
import AppLayout from "../Layouts/AppLayout.vue";
import Button from "../Components/Button.vue";

defineOptions({ layout: AppLayout });
const props = defineProps<{ status: number }>();

const COPY: Record<number, { title: string; body: string }> = {
  403: { title: "Not allowed", body: "You are signed in, but this page is not yours to see." },
  404: {
    title: "No page here",
    body: "The URL does not match any route. Check the address, or head back to the start.",
  },
  419: { title: "The page expired", body: "Load the page again and resubmit." },
  500: { title: "Something broke", body: "That is on us. Try again in a moment." },
};

const copy = computed(
  () => COPY[props.status] ?? { title: "Something went wrong", body: "Try again in a moment." },
);
</script>

<template>
  <Head :title="`${status} — ${copy.title}`" />

  <div class="mx-auto max-w-lg text-center">
    <p class="font-mono text-sm tracking-[0.2em] text-muted-foreground">{{ status }}</p>
    <h1 class="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
      {{ copy.title }}
    </h1>
    <p class="mt-4 text-lg leading-relaxed text-pretty text-muted-foreground">{{ copy.body }}</p>

    <Link href="/" class="mt-8 inline-block">
      <Button>Back to start</Button>
    </Link>
  </div>
</template>
