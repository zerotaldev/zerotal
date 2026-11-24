<script setup lang="ts">
/**
 * The app's surface primitive — a hairline border with a faint inner highlight (see the
 * `surface` utility in resources/css/app.css) instead of a drop shadow. Compose it with
 * CardHeader, CardBody and CardFooter for a titled panel.
 */
</script>

<template>
  <div class="surface rounded-xl"><slot /></div>
</template>
