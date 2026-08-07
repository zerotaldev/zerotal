<script setup lang="ts">
import AppLayout from "../Layouts/AppLayout.vue";

defineOptions({ layout: AppLayout });

defineProps<{
  title: string;
}>();
</script>

<template>
  <section class="py-4">
    <h1 class="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
      {{ title }}
    </h1>
    <div class="mt-6 space-y-4 text-lg leading-relaxed text-gray-600">
      <p>
        This is an example app built with
        <span class="font-medium text-gray-900">Zerotal</span> and its
        <span class="font-medium text-gray-900">Inertia + Vue</span> frontend stack.
      </p>
      <p>
        Each file under
        <code
          class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-indigo-600"
        >
          resources/js/pages
        </code>
        becomes a component you can render from a route — this page lives in
        <code
          class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-indigo-600"
        >
          about.vue
        </code>
        and is served at <span class="font-medium text-gray-900">/about</span>.
        Navigation between pages is handled by Inertia, so it feels instant — no
        full reloads.
      </p>
    </div>
  </section>
</template>
