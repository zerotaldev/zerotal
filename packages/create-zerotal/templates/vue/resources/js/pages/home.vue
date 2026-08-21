<script setup lang="ts">
import { Link } from "@inertiajs/vue3";
import AppLayout from "../Layouts/AppLayout.vue";

// Inertia persistent layout — preserved across client-side navigations.
defineOptions({ layout: AppLayout });

defineProps<{
  title: string;
  message: string;
}>();
</script>

<template>
  <section class="py-10 text-center">
    <span
      class="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700 ring-1 ring-green-600/20"
    >
      <span class="h-2 w-2 rounded-full bg-green-500"></span>
      The install worked successfully!
    </span>

    <h1
      class="mx-auto mt-6 max-w-2xl text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl"
    >
      {{ title.replace(/!$/, "") }} with <span class="text-indigo-600">Vue</span>
    </h1>

    <p class="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-gray-600">
      {{ message }} Edit
      <code
        class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-indigo-600"
      >
        resources/js/pages/home.vue
      </code>
      to get started.
    </p>

    <div class="mt-8 flex items-center justify-center gap-3">
      <Link
        :href="route('about')"
        class="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
      >
        Learn more
      </Link>
      <Link
        :href="route('contact')"
        class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
      >
        Get in touch
      </Link>
    </div>
  </section>
</template>
