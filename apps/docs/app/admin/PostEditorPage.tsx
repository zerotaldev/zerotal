/** @jsxImportSource @zerotal/flow */
import { Component, ErrorMessage, expose, locked, param } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Carbon } from "zerotal/carbon";
import { Auth } from "zerotal/auth";
import { Post, POST_CATEGORIES } from "@app/models/Post.ts";
import { splitBlocks, joinBlocks, blockLabel, blockKind } from "@app/support/markdown-blocks.ts";
import { htmlToMarkdown } from "@app/support/html-to-markdown.ts";
import { AdminLayout } from "./AdminLayout.tsx";
import { PostForm } from "./PostForm.ts";

const INPUT =
  "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-ink " +
  "outline-none transition focus:border-voltage-700 focus:ring-2 focus:ring-voltage-700/20";

// `this.errors.<field>` always returns an ErrorField sentinel, never undefined — it is
// meant for `<ErrorMessage for={…}>`, which shows itself only when that field has an
// error. Use `errors.has(field)` when a plain conditional is needed instead.
const ERROR = "mt-1.5 block text-sm text-red-600";

const MARKDOWN_OPTIONS = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  autolinks: true,
  headings: { ids: true },
};

/** Small square control in a block's hover toolbar. */
const TOOL =
  "flex size-7 items-center justify-center rounded-md text-stone-500 transition " +
  "hover:bg-stone-200 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * Write a post, or edit one — as the post rather than as a form.
 *
 * Both URLs mount this class. On `/admin/posts/:post/edit` the router resolves
 * the segment to a `Post` (by slug — see `Post.resolveRouteBinding`) and `@param`
 * seeds it before `onMount`, so the editor never queries for its own subject. On
 * `/admin/posts/new` there is no segment and the field stays null.
 *
 * The body is edited as blocks: the article renders in its published styling,
 * and clicking a paragraph swaps *that block alone* into a textarea. A block is
 * always Markdown — nothing is ever serialized back out of rendered HTML — so a
 * fenced code block or a table survives an edit exactly as written. That is the
 * whole reason this is not a `contenteditable` over the article: a round trip
 * through the DOM is where WYSIWYG editors quietly eat a code fence.
 *
 * Only the focused block is an input, so Flow's DOM morph is free to repaint
 * everything else without touching a caret.
 */
export class PostEditorPage extends Component {
  static layout = AdminLayout;
  static title = "Write";

  /**
   * Registers `Post` with Flow's model synth. Without it a model field is
   * dehydrated as a plain object and comes back from a WebSocket action with its
   * data but none of its methods — `this.post.fill(...)` then throws, and only
   * on the second interaction, never on the initial render.
   */
  static models = { Post };

  /** @locked — the client renders it but may not write it; the server owns the record. */
  @locked @param(Post) post: Post | null = null;

  @expose form = new PostForm();

  /**
   * Where the open editor sits in the block list, or -1 when the article is
   * just rendered. With {@link isNew}, this is the position it will be inserted
   * at; otherwise it is the index of the block being replaced.
   */
  @expose editing = -1;
  /** The open editor is a block that does not exist yet. */
  @expose isNew = false;
  /**
   * The open block's content, before it is committed back. Rendered HTML while a
   * prose block is being edited richly; Markdown while a raw block is.
   */
  @expose draft = "";
  /** The open block is prose, so `draft` holds HTML and needs converting on commit. */
  @expose draftIsRich = false;
  /**
   * The draft as it was when the block opened. Typing moves `draft` away from
   * this, which is what makes an in-progress edit count as an unsaved change —
   * merely clicking a block does not.
   */
  @locked draftAtOpen = "";

  /**
   * The saved state, as a signature. Compared against the live form to decide
   * whether there is anything to save. `@locked` because the server owns it: a
   * client that could write this could hide the fact that a post is unsaved.
   */
  @locked savedState = "";

  @expose showSettings = false;
  /** Escape hatch: edit the whole body as raw Markdown. */
  @expose sourceMode = false;

  override async onMount(): Promise<void> {
    if (!this.post) {
      // Open on a caret rather than a blank slate with a button to hunt for.
      this.editing = 0;
      this.isNew = true;
      this.draftIsRich = true;
      // An empty new post has nothing to save yet, so the baseline is the empty
      // form — the first keystroke is what makes it saveable.
      this.savedState = this._state();
      return;
    }
    this.form.fill({
      title: this.post.title,
      slug: this.post.slug,
      description: this.post.description ?? "",
      body: this.post.body,
      category: this.post.category ?? POST_CATEGORIES[0],
    });
    this.savedState = this._state();
  }

  /** Everything a save would write, as one comparable value. */
  private _state(): string {
    return JSON.stringify([
      this.form.title,
      this.form.slug,
      this.form.description,
      this.form.category,
      this.form.body,
    ]);
  }

  /**
   * Whether anything would be written by a save — the committed fields differing
   * from the last saved state, or a block open with edits not yet committed.
   */
  get isDirty(): boolean {
    if (this.editing >= 0 && this.draft !== this.draftAtOpen) return true;
    return this._state() !== this.savedState;
  }

  /**
   * The body as blocks.
   *
   * Derived on demand rather than stored: `form.body` is the single source of
   * truth, so a body set any other way — source mode, `fill()`, a test — shows
   * up as blocks immediately, and there is no second copy to fall out of step.
   */
  private _blocks(): string[] {
    return splitBlocks(this.form.body);
  }

  // ── Block editing ───────────────────────────────────────────────────────────

  @expose editBlock(index: number): void {
    // Clicking a second paragraph commits the first. Blur does this too, but a
    // click lands as its own action and must not silently discard the open edit.
    if (this.editing >= 0 && this.editing !== index) this.commitBlock();

    const blocks = this._blocks();
    if (index < 0 || index >= blocks.length) return;

    const markdown = blocks[index] ?? "";
    // Prose is edited as the rendered article — bold looks bold, a heading looks
    // like a heading — so the draft starts as HTML. Code and tables stay text.
    this.draftIsRich = blockKind(markdown) === "prose";
    this.draft = this.draftIsRich ? Bun.markdown.html(markdown, MARKDOWN_OPTIONS) : markdown;
    this.draftAtOpen = this.draft;
    this.editing = index;
    this.isNew = false;
  }

  /**
   * Close the open block, writing the draft back into the body.
   *
   * Fired on blur, which is what makes the page feel like a document rather than
   * a form: click away and the block renders. An existing block emptied this way
   * is removed — deleting all of its text is how a writer deletes a paragraph.
   */
  @expose commitBlock(): void {
    if (this.editing < 0) return;
    const blocks = this._blocks();
    // A rich draft is HTML from the contenteditable; convert it back to the
    // Markdown that is actually stored.
    const text = (this.draftIsRich ? htmlToMarkdown(this.draft) : this.draft).trim();

    if (this.isNew) {
      if (text) blocks.splice(Math.min(this.editing, blocks.length), 0, text);
    } else if (text) {
      blocks[this.editing] = text;
    } else {
      blocks.splice(this.editing, 1);
    }

    this.form.body = joinBlocks(blocks);
    this.editing = -1;
    this.isNew = false;
    this.draft = "";
    this.draftAtOpen = "";
  }

  @expose addBlock(after: number): void {
    // Commit whatever is open first, so the new block is not inserted around a
    // half-finished edit.
    if (this.editing >= 0) this.commitBlock();
    this.editing = Math.min(Math.max(after + 1, 0), this._blocks().length);
    this.isNew = true;
    // New blocks start as prose: someone adding a paragraph should get the rich
    // surface, and the toolbar can turn it into a heading or a list from there.
    this.draftIsRich = true;
    this.draft = "";
    this.draftAtOpen = "";
  }

  @expose deleteBlock(index: number): void {
    const blocks = this._blocks();
    if (index < 0 || index >= blocks.length) return;
    blocks.splice(index, 1);
    this.form.body = joinBlocks(blocks);
    if (this.editing === index) {
      this.editing = -1;
      this.isNew = false;
      this.draft = "";
      this.draftAtOpen = "";
    }
  }

  /** Move a block one position; `delta` is -1 (up) or 1 (down). */
  @expose moveBlock(index: number, delta: number): void {
    const blocks = this._blocks();
    const target = index + delta;
    if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
    this.form.body = joinBlocks(blocks);
  }

  @expose toggleSource(): void {
    if (this.editing >= 0) this.commitBlock();
    this.sourceMode = !this.sourceMode;
  }

  @expose toggleSettings(): void {
    this.showSettings = !this.showSettings;
  }

  // ── Saving ──────────────────────────────────────────────────────────────────

  /** Validate, then create or update. `publish` of null leaves live/draft alone. */
  private async _persist(publish: boolean | null): Promise<Post> {
    // Fold in anything still open, so Save works without clicking away first.
    if (this.editing >= 0) this.commitBlock();

    // Settle the slug before validating, so the rules judge the value that will
    // actually be saved rather than the empty box the author left alone.
    this.form.slug = this.form.derivedSlug();
    await this.validate(this.form);

    const slug = await Post.uniqueSlug(this.form.derivedSlug(), this.post?.id);
    const attributes = {
      title: this.form.title,
      slug,
      description: this.form.description,
      body: this.form.body,
      category: this.form.category,
    };

    if (this.post) {
      this.post.fill(attributes);
      if (publish !== null) this.post.publishedAt = publish ? Carbon.now() : null;
      await this.post.save();
      this.form.slug = slug;
      // Written — this is the new baseline, so Save steps back out of the way.
      this.savedState = this._state();
      return this.post;
    }

    const post = new Post();
    post.fill(attributes);
    post.authorId = Auth.id();
    post.publishedAt = publish ? Carbon.now() : null;
    await post.save();
    return post;
  }

  /** Save without changing whether the post is live. */
  @expose async save(): Promise<void> {
    const post = await this._persist(null);
    if (this.post) {
      this.flash("Saved.");
      return;
    }
    // A new post has no URL of its own yet — send the author to its editor so a
    // second save updates rather than creating a duplicate.
    this.redirect(`/admin/posts/${post.slug}/edit`).withSuccess("Draft saved.");
  }

  @expose async publish(): Promise<void> {
    const post = await this._persist(true);
    this.redirect(`/admin/posts/${post.slug}/edit`).withSuccess(`Published to /blog/${post.slug}.`);
  }

  @expose async unpublish(): Promise<void> {
    if (!this.post) return;
    this.post.publishedAt = null;
    await this.post.save();
    this.flash("Moved back to drafts.");
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  /** The open block's editor — rich for prose, plain text for code and tables. */
  private _renderEditor(): HtmlNode {
    return this.draftIsRich ? this._renderRichEditor() : this._renderTextEditor();
  }

  /**
   * Prose: the block edited in place.
   *
   * The editable element sits directly in the article's prose flow and carries
   * no styling of its own, so a heading stays a heading and a list stays a list
   * while it is being written — the point of the whole thing. Nothing wraps it
   * in `not-prose`: that class excludes its entire subtree from prose styling,
   * even from a nearer `prose` ancestor, which is what collapsed an `<h1>` to
   * body text.
   *
   * The chrome is deliberately absent. The toolbar floats above the block and
   * the only other affordance is a hairline down the left margin, so the page
   * still reads as the article rather than as a form.
   */
  private _renderRichEditor(): HtmlNode {
    const editorId = `rt-${this.editing}`;
    const fieldId = `rt-field-${this.editing}`;

    return (
      <div class="relative -mx-4 px-4">
        {/* Marks the live block without a box or a colour wash. Absolutely
            positioned so it never nudges the text. */}
        <span class="not-prose absolute top-0 bottom-0 -left-1 w-0.5 rounded-full bg-voltage-700/40"></span>

        <div class="not-prose absolute -top-11 left-2 z-20 flex flex-wrap items-center gap-0.5 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
          {this._toolButton("Bold", "bold", "font-bold", "B")}
          {this._toolButton("Italic", "italic", "italic", "I")}
          {this._toolButton("Link", "createLink", "", "🔗")}
          <span class="mx-1 h-4 w-px bg-stone-200"></span>
          {this._toolButton("Heading", "formatBlock", "font-semibold", "H2", "h2")}
          {this._toolButton("Sub-heading", "formatBlock", "font-semibold", "H3", "h3")}
          {this._toolButton("Body text", "formatBlock", "", "¶", "p")}
          <span class="mx-1 h-4 w-px bg-stone-200"></span>
          {this._toolButton("Bulleted list", "insertUnorderedList", "", "•")}
          {this._toolButton("Numbered list", "insertOrderedList", "", "1.")}
          {this._toolButton("Quote", "formatBlock", "", "❝", "blockquote")}
          <span class="mx-1 h-4 w-px bg-stone-200"></span>
          <button
            type="button"
            onClick={this.commitBlock}
            class="rounded px-2.5 py-1 text-xs font-semibold text-voltage-700 transition hover:bg-voltage-50"
          >
            Done
          </button>
        </div>

        {/* The Flow-modeled carrier: the editor's HTML is pushed here, and this
            is what reaches the server. */}
        <textarea value={this.draft} live id={fieldId} class="hidden"></textarea>

        {/* flow:ignore keeps the DOM morph out of the subtree holding the caret;
            without it every server patch would rewrite the text being typed. The
            initial HTML is server-rendered, so the block reads correctly before
            any script runs. */}
        <div
          id={editorId}
          key={editorId}
          data-rich
          data-rich-focus
          data-rich-field={fieldId}
          flow:ignore
          contenteditable="true"
          class="outline-none"
          dangerouslySetInnerHTML={{ __html: this.draft }}
        ></div>
      </div>
    );
  }

  private _toolButton(
    title: string,
    command: string,
    extra: string,
    label: string,
    value?: string,
  ): HtmlNode {
    const cls =
      "rounded px-2 py-1 text-xs text-stone-600 transition hover:bg-stone-200 hover:text-ink " +
      extra;
    return (
      <button
        type="button"
        title={title}
        // Runs before blur so the selection is still live; the editor's own
        // input event then carries the change to the server.
        onMouseDown={`event.preventDefault(); __ztCmd('${command}'${value ? `,'${value}'` : ""})`}
        class={cls}
      >
        {label}
      </button>
    );
  }

  /** Code, tables and embedded HTML: edited exactly as written. */
  private _renderTextEditor(): HtmlNode {
    // Sized to the content so the box does not jump between a one-line
    // paragraph and a thirty-line code fence.
    const rows = Math.max(3, this.draft.split("\n").length + 1);
    return (
      <div class="not-prose my-1 overflow-hidden rounded-lg ring-2 ring-voltage-700/30">
        <textarea
          value={this.draft}
          live
          autofocus
          rows={rows}
          onBlur={this.commitBlock}
          placeholder="Code, table or HTML…"
          class="w-full resize-none border-0 bg-white px-4 py-3 font-mono text-[0.8125rem] leading-6 text-ink outline-none"
        ></textarea>
        <div class="flex items-center justify-between gap-3 border-t border-stone-200 bg-stone-50 px-3 py-1.5">
          <span class="text-xs text-stone-500">
            Edited as written — code and tables are never reformatted
          </span>
          <button
            type="button"
            onClick={this.commitBlock}
            class="rounded-md px-2.5 py-1 text-xs font-semibold text-voltage-700 transition hover:bg-voltage-50"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  /** One rendered block, with its hover controls. */
  private _renderBlock(markdown: string, index: number, total: number): HtmlNode {
    const html = markdown.trim()
      ? Bun.markdown.html(markdown, MARKDOWN_OPTIONS)
      : `<p class="text-stone-400">Empty block — click to write.</p>`;

    return (
      <div class="group relative -mx-4 rounded-lg px-4 transition hover:bg-white/70">
        {/* Controls sit outside the text column so they never reflow the article. */}
        <div class="not-prose absolute top-1 -left-11 flex flex-col gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            title="Move up"
            disabled={index === 0}
            onClick={() => this.moveBlock(index, -1)}
            class={TOOL}
          >
            ↑
          </button>
          <button
            type="button"
            title="Move down"
            disabled={index === total - 1}
            onClick={() => this.moveBlock(index, 1)}
            class={TOOL}
          >
            ↓
          </button>
          <button
            type="button"
            title="Delete block"
            confirm={`Delete this block? "${blockLabel(markdown)}"`}
            onClick={() => this.deleteBlock(index)}
            class={`${TOOL} hover:bg-red-100 hover:text-red-600`}
          >
            ⨯
          </button>
        </div>

        <div onClick={() => this.editBlock(index)} class="cursor-text">
          <div dangerouslySetInnerHTML={{ __html: html }}></div>
        </div>

        {/* Insert between blocks — the hairline a writer aims at to add a paragraph. */}
        <button
          type="button"
          title="Add a block below"
          onClick={() => this.addBlock(index)}
          class="not-prose absolute -bottom-3 left-0 flex h-6 w-full items-center opacity-0 transition group-hover:opacity-100"
        >
          <span class="h-px flex-1 bg-voltage-700/30"></span>
          <span class="mx-2 rounded-full border border-stone-300 bg-white px-2 text-xs text-stone-500">
            +
          </span>
          <span class="h-px flex-1 bg-voltage-700/30"></span>
        </button>
      </div>
    );
  }

  /**
   * The article body: every block, with the open editor spliced in at its
   * position. Walking one past the end lets a new block be inserted anywhere,
   * including after the last paragraph.
   */
  private _renderBody(): HtmlNode[] {
    const blocks = this._blocks();

    if (blocks.length === 0 && this.editing < 0) {
      return [
        <button
          type="button"
          onClick={() => this.addBlock(-1)}
          class="not-prose w-full rounded-xl border border-dashed border-stone-300 py-10 text-sm text-stone-500 transition hover:border-voltage-700/40 hover:text-ink"
        >
          Write the first paragraph
        </button>,
      ];
    }

    const nodes: HtmlNode[] = [];
    for (let index = 0; index <= blocks.length; index++) {
      if (this.isNew && this.editing === index) nodes.push(this._renderEditor());
      if (index === blocks.length) break;
      nodes.push(
        !this.isNew && this.editing === index
          ? this._renderEditor()
          : this._renderBlock(blocks[index]!, index, blocks.length),
      );
    }
    return nodes;
  }

  override async render(): Promise<HtmlNode> {
    const isPublished = this.post?.isPublished ?? false;
    const slug = this.form.derivedSlug();

    return (
      <section class="mx-auto max-w-3xl">
        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <header class="not-prose sticky top-0 z-10 -mx-6 mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-stone-50/90 px-6 py-3 backdrop-blur">
          <div class="min-w-0">
            <p class="truncate text-sm text-stone-500">
              {this.post ? (
                <>
                  {isPublished ? "Live at " : "Draft — "}
                  <a href={`/blog/${slug}`} class="text-voltage-700">
                    /blog/{slug}
                  </a>
                </>
              ) : (
                "New post — not saved yet."
              )}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <a
              href="/admin"
              class="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 no-underline transition hover:bg-stone-100"
            >
              Back
            </a>
            <button
              type="button"
              onClick={this.toggleSource}
              class="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100"
            >
              {this.sourceMode ? "Blocks" : "Source"}
            </button>
            <button
              type="button"
              onClick={this.toggleSettings}
              class="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100"
            >
              Settings
            </button>
            {isPublished ? (
              <button
                type="button"
                onClick={this.unpublish}
                class="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium transition hover:bg-stone-50"
              >
                Unpublish
              </button>
            ) : (
              ""
            )}
            {/* Save appears only when there is something to write. The quiet
                "Saved" keeps the spot occupied, so the toolbar does not shuffle
                sideways every time the state flips. */}
            {this.isDirty ? (
              <button
                type="button"
                onClick={this.save}
                loadingAttr="disabled"
                class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium transition hover:bg-stone-50 disabled:opacity-60"
              >
                Save
              </button>
            ) : (
              <span class="px-3 py-2 text-sm text-stone-400" aria-live="polite">
                Saved
              </span>
            )}
            {isPublished ? (
              ""
            ) : (
              <button
                type="button"
                onClick={this.publish}
                loadingAttr="disabled"
                class="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-cream transition hover:bg-ink/90 disabled:opacity-60"
              >
                Publish
              </button>
            )}
          </div>
        </header>

        {/* ── Settings ────────────────────────────────────────────────────── */}
        {this.showSettings ? (
          <div class="not-prose mb-10 grid gap-5 rounded-xl border border-stone-200 bg-white p-5 sm:grid-cols-2">
            <div>
              <label class="text-sm font-medium text-stone-700">Slug</label>
              <input value={this.form.slug} placeholder={slug || "from-the-title"} class={INPUT} />
              <ErrorMessage for={this.errors["slug"]} class={ERROR} />
              {this.errors.has("slug") ? (
                ""
              ) : (
                <p class="mt-1.5 text-xs text-stone-500">Leave blank to use the title.</p>
              )}
            </div>
            <div>
              <label class="text-sm font-medium text-stone-700">Category</label>
              <select value={this.form.category} class={INPUT}>
                {POST_CATEGORIES.map((name) => (
                  <option value={name}>{name}</option>
                ))}
              </select>
              <ErrorMessage for={this.errors["category"]} class={ERROR} />
            </div>
            <div class="sm:col-span-2">
              <label class="text-sm font-medium text-stone-700">Description</label>
              <textarea value={this.form.description} rows={2} class={INPUT}></textarea>
              <ErrorMessage for={this.errors["description"]} class={ERROR} />
              {this.errors.has("description") ? (
                ""
              ) : (
                <p class="mt-1.5 text-xs text-stone-500">Shown on the blog index and in search.</p>
              )}
            </div>
          </div>
        ) : (
          ""
        )}

        {/* ── The post ────────────────────────────────────────────────────── */}
        <article class="prose prose-stone max-w-none">
          {/* Labelled, because a post's `title` is not the same thing as the `#`
              heading its body usually opens with: this one is what the blog index,
              the <title> tag and the OG card use. Without the label the two read
              as one duplicated heading. */}
          <div class="not-prose mb-8 border-b border-stone-200 pb-6">
            <label class="text-xs font-semibold tracking-wide text-stone-400 uppercase">
              Title · index, tab and social card
            </label>
            <input
              value={this.form.title}
              live
              placeholder="Post title"
              class="font-display mt-1 w-full border-0 bg-transparent p-0 text-3xl font-bold tracking-[-0.03em] text-ink placeholder:text-stone-300 focus:outline-none"
            />
            <ErrorMessage for={this.errors["title"]} class={ERROR} />
          </div>

          {this.sourceMode ? (
            <div class="not-prose mt-8">
              <textarea
                value={this.form.body}
                live
                rows={30}
                placeholder="Write in Markdown…"
                class="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 font-mono text-[0.8125rem] leading-6 outline-none focus:border-voltage-700"
              ></textarea>
              <ErrorMessage for={this.errors["body"]} class={ERROR} />
              <p class="mt-2 text-xs text-stone-500">
                The whole body as Markdown. Switch back to Blocks and it re-splits.
              </p>
            </div>
          ) : (
            <div class="mt-2">
              {this._renderBody()}
              <ErrorMessage for={this.errors["body"]} class={`not-prose ${ERROR}`} />
            </div>
          )}
        </article>
      </section>
    );
  }
}
