import { Command, tableNameFor } from "@zerotal/core";

const HEADER = `// Channel authorization rules. Loaded once at boot by BroadcastProvider.
// Patterns use the file-routing [param] placeholder syntax.
`;

const BROADCAST_IMPORT = `import { Broadcast } from "@zerotal/broadcasting";`;
const USER_IMPORT = `import type { User } from "../app/models/User.ts";`;

/**
 * Scaffolds a channel authorization rule into `routes/channels.ts`. Channels are plain
 * `Broadcast.channel(...)` registrations, not classes — so this appends a rule rather than
 * creating a new file per channel.
 *
 * @example
 *   bun zt make:channel Order            // -> orders.[id]   (private)
 *   bun zt make:channel orders.[orderId] // -> orders.[orderId] (private)
 *   bun zt make:channel chat.[roomId] -p // -> presence rule
 */
export class MakeChannelCommand extends Command {
  static override commandName = "make:channel";
  static override description = "Add a channel authorization rule to routes/channels.ts";
  static override needsApp = false;
  static override args = [
    {
      name: "name",
      required: true,
      description: "Channel pattern or model name (e.g. orders.[orderId] or Order)",
    },
  ];
  static override flags = [
    {
      name: "presence",
      short: "p",
      type: "boolean" as const,
      description: "Generate a presence-channel rule (returns member data)",
      default: false,
    },
  ];

  async run(): Promise<void> {
    const raw = this.args["name"]!;
    const presence = this.flags["presence"] as boolean;
    const pattern = normalizePattern(raw);
    const path = "routes/channels.ts";

    let content = (await Bun.file(path).exists())
      ? await Bun.file(path).text()
      : `${HEADER}${BROADCAST_IMPORT}\n${USER_IMPORT}\n`;

    if (content.includes(`Broadcast.channel("${pattern}"`)) {
      this.error(`A rule for "${pattern}" already exists in ${path}.`);
      return;
    }

    // Ensure the required imports exist when appending to a hand-written file.
    if (!content.includes("@zerotal/broadcasting")) {
      content = `${BROADCAST_IMPORT}\n${content}`;
    }
    if (!content.includes("models/User")) {
      content = content.replace(BROADCAST_IMPORT, `${BROADCAST_IMPORT}\n${USER_IMPORT}`);
    }

    content = `${content.replace(/\n*$/, "")}\n\n${channelBlock(pattern, presence)}\n`;
    await Bun.write(path, content);
    this.info(`Added ${presence ? "presence" : "private"} channel rule "${pattern}" to ${path}`);
  }
}

/** A bare model-ish name (no dot, no bracket) becomes `<plural snake>.[id]`. `Order` -> `orders.[id]`. */
function normalizePattern(name: string): string {
  if (!name.includes(".") && !name.includes("[")) {
    return `${tableNameFor(name)}.[id]`;
  }
  return name;
}

/** Extract `[param]` names from a channel pattern, in order. */
function paramNames(pattern: string): string[] {
  const out: string[] = [];
  const re = /\[(\w+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern)) !== null) out.push(m[1]!);
  return out;
}

function channelBlock(pattern: string, presence: boolean): string {
  const params = paramNames(pattern);
  // Channel params are unused in the stub body; prefix with `_` so they pass noUnusedParameters.
  // Rename (drop the underscore) when you reference them.
  const sig = ["user: User", ...params.map((p) => `_${p}: string`)].join(", ");
  const subject = params.length ? params.map((p) => `\`${p}\``).join(", ") : "this channel";

  if (presence) {
    return `// ${pattern} — presence channel: return member data to authorize + publish presence, or null to deny.
Broadcast.channel("${pattern}", (${sig}) => {
  if (user == null) return null;
  // TODO: authorize \`user\` against ${subject}, then return the info to expose to other members.
  return { id: user.id };
});`;
  }

  return `// ${pattern} — private channel: return true when the user may listen.
Broadcast.channel("${pattern}", (${sig}) => {
  // TODO: authorize \`user\` against ${subject}.
  return user != null;
});`;
}
