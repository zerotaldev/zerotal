<script setup lang="ts">
/**
 * The page behind every HTTP error the app renders to a browser.
 *
 * `app/exceptions/Handler.ts` picks the status and renders this component, so a missing
 * URL lands inside the app's own shell instead of on a bare framework page — the sidebar
 * for someone signed in, the public header for everyone else. In development the
 * framework's stack-trace page still wins for 500s; this is what production shows.
 */
import { computed } from "vue";
import { Head, usePage } from "@inertiajs/vue3";
import AppLayout from "../Layouts/AppLayout.vue";
import PublicLayout from "../Layouts/PublicLayout.vue";
import Button from "../Components/Button.vue";
import Icon from "../Components/Icon.vue";
import type { IconName } from "../lib/icons";
import type { SharedProps } from "../types";

const props = defineProps<{ status: number }>();

const COPY: Record<number, { title: string; body: string; icon: IconName }> = {
  403: {
    title: "You don't have access to this",
    body: "This page exists, but it belongs to someone else. If you think that is wrong, ask whoever shared the link.",
    icon: "lock",
  },
  404: {
    title: "Page not found",
    body: "Nothing lives at this address. It may have moved, or the link may have a typo in it.",
    icon: "search",
  },
  419: {
    title: "This page expired",
    body: "The form sat open long enough for its security token to run out. Reload the page and send it again.",
    icon: "clock",
  },
  429: {
    title: "Slow down a little",
    body: "That was a lot of requests in a short time. Wait a moment, then try again.",
    icon: "clock",
  },
  500: {
    title: "Something went wrong on our side",
    body: "The error has been logged. Try again in a moment — if it keeps happening, let us know.",
    icon: "alert",
  },
  503: {
    title: "Down for maintenance",
    body: "We are making some changes. The app will be back shortly.",
    icon: "clock",
  },
};

const page = usePage<SharedProps>();
const signedIn = computed(() => Boolean(page.props.auth.user));
const copy = computed(() => COPY[props.status] ?? COPY[500]!);

const reload = () => window.location.reload();
const back = () => window.history.back();
</script>

<template>
  <Head :title="copy.title" />

  <!-- The shell the visitor was already in: the sidebar once signed in, the public header before. -->
  <component :is="signedIn ? AppLayout : PublicLayout">
    <section class="mx-auto flex max-w-lg flex-col items-center py-10 text-center sm:py-16">
      <div
        class="grid size-14 place-items-center rounded-2xl border border-border bg-accent text-accent-foreground"
      >
        <Icon :name="copy.icon" class="size-7" />
      </div>

      <p class="mt-6 font-mono text-sm font-semibold tracking-widest text-primary">
        ERROR {{ status }}
      </p>
      <h1 class="mt-2 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
        {{ copy.title }}
      </h1>
      <p class="mt-3 leading-relaxed text-pretty text-muted-foreground">{{ copy.body }}</p>

      <div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button v-if="status === 419" @click="reload">Reload the page</Button>
        <Button v-else :href="signedIn ? route('dashboard') : route('home')">
          {{ signedIn ? "Go to the dashboard" : "Back to home" }}
        </Button>
        <Button variant="secondary" @click="back">Go back</Button>
      </div>
    </section>
  </component>
</template>
