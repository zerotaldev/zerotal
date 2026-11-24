<script setup lang="ts">
import { Head } from "@inertiajs/vue3";
import SettingsLayout from "../../Layouts/SettingsLayout.vue";
import Card from "../../Components/Card.vue";
import CardBody from "../../Components/CardBody.vue";
import CardHeader from "../../Components/CardHeader.vue";
import Icon from "../../Components/Icon.vue";
import type { IconName } from "../../lib/icons";
import { setAppearance, useAppearance, type Appearance } from "../../lib/theme";

defineOptions({ layout: SettingsLayout });
defineProps<{ title: string }>();

const OPTIONS: { value: Appearance; label: string; description: string; icon: IconName }[] = [
  { value: "light", label: "Light", description: "Always light.", icon: "sun" },
  { value: "dark", label: "Dark", description: "Always dark.", icon: "moon" },
  { value: "system", label: "System", description: "Match this device.", icon: "laptop" },
];

const appearance = useAppearance();
</script>

<template>
  <Head :title="title" />

  <Card>
    <CardHeader
      title="Appearance"
      description="Kept in this browser, so each of your devices can have its own."
    />
    <CardBody>
      <fieldset>
        <legend class="sr-only">Theme</legend>
        <div class="grid gap-3 sm:grid-cols-3">
          <label
            v-for="option in OPTIONS"
            :key="option.value"
            :class="[
              'flex cursor-pointer flex-col gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              appearance === option.value
                ? 'border-primary bg-accent'
                : 'border-border hover:bg-muted',
            ]"
          >
            <input
              type="radio"
              name="appearance"
              :value="option.value"
              :checked="appearance === option.value"
              class="sr-only"
              @change="setAppearance(option.value)"
            />
            <Icon
              :name="option.icon"
              :class="[
                'size-5',
                appearance === option.value ? 'text-primary' : 'text-muted-foreground',
              ]"
            />
            <span>
              <span class="block text-sm font-medium">{{ option.label }}</span>
              <span class="block text-sm text-muted-foreground">{{ option.description }}</span>
            </span>
          </label>
        </div>
      </fieldset>
    </CardBody>
  </Card>
</template>
