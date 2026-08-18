// Two subclasses of one decorated base, drained in either order.
//
// The registries are filled by a lazy drain: a field decorator buffers
// {name, apply} at class-definition time, and the buffer is matched to a class
// the first time somebody reads that class's registry. Matching picked the
// longest run across EVERY buffered group, so a class could claim — and splice
// away — an entry belonging to a *sibling* whose group merely shared a name.
//
// In tracker-flow that was a 500: `NewIssuePage` declares `project`,
// `EditIssuePage` declares `project` and `issue`, and both extend one form base.
// Render the new-issue page first and it took `EditIssuePage`'s `project` entry,
// so the edit page never registered `project`, `_seedRouteParams` skipped it, and
// `render()` died on `this.project.slug`. Render the edit page first and both are
// fine — which is what made it look flaky rather than broken.

import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import { expose, locked, getLockedProps, getExposedProps } from "./decorators.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

async function html(): Promise<HtmlNode> {
  return { html: "<div></div>" };
}

abstract class FormBase extends Component {
  @expose title = "";
  @expose body = "";
}

// Defined before the sibling, so its group sits EARLIER in the buffer — the
// order in which the bug bites, since ties went to the newest group.
class NewPage extends FormBase {
  @locked project!: object;
  override render = html;
}

class EditPage extends FormBase {
  @locked project!: object;
  @locked issue!: object;
  override render = html;
}

describe("sibling subclasses of a decorated base", () => {
  it("each registers its own fields, whichever is read first", () => {
    // Read the one-field sibling first. This is the order that broke.
    const newLocked = getLockedProps(new NewPage());
    expect([...newLocked].sort()).toEqual(["project"]);

    const editLocked = getLockedProps(new EditPage());
    // `issue` alone here is the bug: `project` was claimed by NewPage's drain.
    expect([...editLocked].sort()).toEqual(["issue", "project"]);
  });

  it("the shared base's own fields still reach both", () => {
    const exposed = getExposedProps(new EditPage());
    expect(exposed.has("title")).toBe(true);
    expect(exposed.has("body")).toBe(true);
  });
});
