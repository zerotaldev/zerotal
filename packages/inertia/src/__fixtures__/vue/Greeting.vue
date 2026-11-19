<script setup lang="ts">
import { Head } from "@inertiajs/vue3";
import { computed } from "vue";

const props = defineProps<{ name: string; items: string[] }>();
const shout = computed(() => props.name.toUpperCase());
</script>

<template>
  <Head title="Greeting page" />
  <main class="greeting">
    <h1>Hello, {{ shout }}</h1>
    <ul>
      <li v-for="item in items" :key="item">{{ item }}</li>
    </ul>
  </main>
</template>

<style scoped>
.greeting {
  color: rebeccapurple;
}
</style>
