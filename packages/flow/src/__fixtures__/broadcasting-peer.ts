/**
 * The entry `optionalPeers.test.ts` bundles and runs, standing in for a compiled app.
 *
 * It fills a `@presence` property and commits a change to a `@shared` one, the two things that
 * load `@zerotal/broadcasting`, and prints one JSON line with how each went. When broadcasting can
 * be loaded here, its fake records what `@shared` sent, so the line also says whether flow reached
 * the same copy of the package the app has.
 */
import { Component } from "../Component.ts";
import { presence, shared } from "../decorators.ts";
import type { HtmlNode } from "../jsx-runtime.ts";
import { populatePresence } from "../presence.ts";
import { commitShared, snapshotSharedValues } from "../shared.ts";

/** The part of `@zerotal/broadcasting` this observes flow with. */
interface BroadcastingModule {
  Broadcast: { fake(): { recorded(): { channel: string; event: string }[] } };
}

/** The parts of an error the test asserts on. */
function describeError(error: unknown): Record<string, unknown> {
  return {
    threw: error instanceof Error ? error.constructor.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  };
}

class RoomPage extends Component {
  @presence("lobby") members: unknown[] = [];
  @shared("board") notes: string[] = [];

  override async render(): Promise<HtmlNode> {
    return { html: "<div></div>" };
  }
}

// `null` when broadcasting cannot be loaded here, or is broken.
const broadcasting: BroadcastingModule | null = await import(
  "@zerotal/broadcasting" as string
).catch(() => null);
const fake = broadcasting?.Broadcast.fake() ?? null;

let presenceResult: Record<string, unknown>;
try {
  const page = new RoomPage();
  await populatePresence(page);
  presenceResult = { members: page.members };
} catch (error) {
  presenceResult = describeError(error);
}

let sharedResult: Record<string, unknown>;
try {
  const page = new RoomPage();
  const before = snapshotSharedValues(page);
  page.notes.push("hello");
  const changed = await commitShared(page, before);
  sharedResult = { changed, broadcasts: fake ? fake.recorded().map((b) => b.channel) : null };
} catch (error) {
  sharedResult = describeError(error);
}

console.log(JSON.stringify({ presence: presenceResult, shared: sharedResult }));
