<script setup lang="ts">
import { computed, ref } from "vue";
import { Head } from "@inertiajs/vue3";
import SettingsLayout from "../../Layouts/SettingsLayout.vue";
import Badge from "../../Components/Badge.vue";
import Button from "../../Components/Button.vue";
import Card from "../../Components/Card.vue";
import CardFooter from "../../Components/CardFooter.vue";
import CardHeader from "../../Components/CardHeader.vue";
import Icon from "../../Components/Icon.vue";
import PasswordDialog from "../../Components/PasswordDialog.vue";
import { timeAgo } from "../../lib/format";

defineOptions({ layout: SettingsLayout });

const props = defineProps<{
  title: string;
  sessions: {
    id: string;
    browser: string;
    platform: string;
    ipAddress: string | null;
    lastActiveAt: string;
    current: boolean;
  }[];
}>();

const confirming = ref(false);
const others = computed(() => props.sessions.filter((session) => !session.current).length);
</script>

<template>
  <Head :title="title" />

  <Card>
    <CardHeader
      title="Where you're signed in"
      description="If you don't recognise a device, sign it out and change your password."
    />
    <ul class="mt-5 divide-y divide-border border-y border-border">
      <li
        v-for="session in sessions"
        :key="session.id"
        class="flex items-center gap-4 px-5 py-4 sm:px-6"
      >
        <Icon
          :name="/iOS|Android/.test(session.platform) ? 'phone' : 'monitor'"
          class="size-6 shrink-0 text-muted-foreground"
        />
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2 text-sm font-medium">
            {{ session.browser }} on {{ session.platform }}
            <Badge v-if="session.current" tone="success">This device</Badge>
          </p>
          <p class="text-sm text-muted-foreground">
            {{ session.ipAddress ?? "Unknown address" }} ·
            {{ session.current ? "Active now" : `Last active ${timeAgo(session.lastActiveAt)}` }}
          </p>
        </div>
      </li>
    </ul>
    <CardFooter class="rounded-t-none border-t-0">
      <Button variant="secondary" :disabled="others === 0" @click="confirming = true">
        Sign out other sessions
      </Button>
    </CardFooter>
  </Card>

  <PasswordDialog
    :open="confirming"
    title="Sign out other sessions?"
    description="Every other browser and device will be signed out. Enter your password to confirm."
    method="delete"
    :url="route('settings.sessions.destroy')"
    confirm-label="Sign them out"
    busy-label="Signing out…"
    variant="primary"
    @close="confirming = false"
  />
</template>
