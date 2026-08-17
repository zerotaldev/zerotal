import { Component, Link, expose, locked } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import type { RuleBuilder } from "zerotal/validator";
import { User } from "@app/models/User.ts";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@app/models/Issue.ts";
import { StoreIssueRequest } from "@app/requests/StoreIssueRequest.ts";
import {
  ERROR,
  FIELD,
  LABEL,
  PRIORITY_LABEL,
  PRIMARY,
  SECONDARY,
  SELECT,
  STATUS_LABEL,
  TEXTAREA,
} from "../ui.ts";

/**
 * The five fields both issue forms hold, and the markup that draws them.
 *
 * An abstract base rather than a child component, because the two pages differ
 * only in what `save()` does and where "cancel" goes — everything above that is
 * one form. Flow scans the prototype chain for decorated members, so a subclass
 * declaring its own `@expose` field does not wipe the base's actions off the
 * allowlist; that shape is regression-tested in the framework
 * (`decorator-inheritance.test.ts`) precisely because it used to.
 *
 * It lives in `app/flow/forms` rather than beside the pages on purpose:
 * everything under `app/flow/pages` is scanned as a route, and a `Component`
 * subclass exported from there would be registered as a page of its own.
 */
export abstract class IssueFormPage extends Component {
  @expose title_ = "";
  @expose body = "";
  @expose status = "backlog";
  @expose priority = "medium";

  /**
   * Held as `number | null`, not as the string a `<select>` writes.
   *
   * The client writes `""` for the unselected option — HTML has no way to say
   * null — and `save()` normalises it before validating, in the same position
   * and for the same reason as `prepareForValidation()` in the shared
   * `StoreIssueRequest`. Keeping the *validated* type on the property is what
   * lets the shared rule (`r.number().optional().nullable()`) apply unchanged.
   */
  @expose assigneeId: number | null = null;

  @locked people: { id: number; name: string }[] = [];

  /** Where "Cancel" goes, and where a successful save lands. */
  protected abstract cancelHref(): string;

  /** The word on the submit button. */
  protected abstract submitLabel(): string;

  protected async loadPeople(): Promise<void> {
    const people = await User.query().orderBy("name").get();
    this.people = people.map((person) => ({ id: person.id, name: person.name }));
  }

  /**
   * Validate against the *shared* rules, not a restatement of them.
   *
   * `StoreIssueRequest.rules()` is the same method the view and Inertia builds
   * validate every issue POST against. `FormRequest.validate()` itself cannot be
   * called from here — it reads a request body, and a socket frame has none —
   * but `rules()` is just a builder callback, and a builder callback travels.
   * Change `min(3)` there and this form changes with it.
   *
   * `title_` rather than `title`: `title()` is one of `Component`'s own action
   * helpers (it sets the document title), so a property called `title` would
   * shadow it. The trailing underscore is ugly and deliberate — the alternative
   * is a page that cannot set its own title, and the framework reserves the name
   * (`reserved-members.test.ts`). The field is mapped back to `title` for
   * validation and for the model, so nothing outside this class sees it.
   */
  protected async validateShared(): Promise<{
    title: string;
    body: string;
    status: string;
    priority: string;
    assigneeId: number | null;
  }> {
    // The same normalisation `prepareForValidation()` does, in the same place:
    // immediately before the rules run.
    if ((this.assigneeId as unknown) === "") this.assigneeId = null;
    else if (typeof this.assigneeId === "string") this.assigneeId = Number(this.assigneeId);

    const shared = (r: RuleBuilder) => new StoreIssueRequest().rules(r);

    await this.validate({
      title_: (r) => shared(r).title,
      body: (r) => shared(r).body,
      status: (r) => shared(r).status,
      priority: (r) => shared(r).priority,
      assigneeId: (r) => shared(r).assigneeId,
    });

    return {
      title: this.title_,
      body: this.body,
      status: this.status,
      priority: this.priority,
      assigneeId: this.assigneeId,
    };
  }

  /** The form itself — identical in both pages, so it is written once. */
  protected renderForm(save: () => void): HtmlNode {
    return (
      <form onSubmit={save} class="space-y-5">
        <div class="space-y-1.5">
          <label class={LABEL} for="title">
            {__("Title")}
          </label>
          {/* `live` on the title alone: it is the one field with a length rule a
              reader can trip in normal use, and finding out at three characters
              beats finding out at submit. The rest validate on save. */}
          <input id="title" required class={FIELD} value={this.title_} live />
          <span error={this.errors.title_} class={ERROR} />
        </div>

        <div class="space-y-1.5">
          <label class={LABEL} for="body">
            {__("Description")}
          </label>
          <textarea id="body" rows="6" class={TEXTAREA} value={this.body}>
            {this.body}
          </textarea>
          <span error={this.errors.body} class={ERROR} />
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <div class="space-y-1.5">
            <label class={LABEL} for="status">
              {__("Status")}
            </label>
            <select id="status" class={`${SELECT} h-10 w-full`} value={this.status}>
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {__(STATUS_LABEL[s] ?? s)}
                </option>
              ))}
            </select>
            <span error={this.errors.status} class={ERROR} />
          </div>

          <div class="space-y-1.5">
            <label class={LABEL} for="priority">
              {__("Priority")}
            </label>
            <select id="priority" class={`${SELECT} h-10 w-full`} value={this.priority}>
              {ISSUE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {__(PRIORITY_LABEL[p] ?? p)}
                </option>
              ))}
            </select>
            <span error={this.errors.priority} class={ERROR} />
          </div>
        </div>

        <div class="space-y-1.5">
          <label class={LABEL} for="assigneeId">
            {__("Assignee")}
          </label>
          <select id="assigneeId" class={`${SELECT} h-10 w-full`} value={this.assigneeId}>
            <option value="">{__("Unassigned")}</option>
            {this.people.map((person) => (
              <option key={String(person.id)} value={String(person.id)}>
                {person.name}
              </option>
            ))}
          </select>
          <span error={this.errors.assigneeId} class={ERROR} />
        </div>

        <div class="flex justify-end gap-2 border-t border-border pt-5">
          <Link href={this.cancelHref()} hover class={SECONDARY}>
            {__("Cancel")}
          </Link>
          <button type="submit" loadingAttr="disabled" class={PRIMARY}>
            {this.submitLabel()}
          </button>
        </div>
      </form>
    );
  }
}
