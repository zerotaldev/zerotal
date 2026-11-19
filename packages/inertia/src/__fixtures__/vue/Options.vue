<script lang="ts">
export default {
  props: { count: { type: Number, required: true } },
  computed: {
    doubled(): number {
      return (this as unknown as { count: number }).count * 2;
    },
  },
};
</script>

<template>
  <p class="options">Count {{ count }}, doubled {{ doubled }}</p>
</template>
