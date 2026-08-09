---
title: "Zerotal: Stop Wiring, Start Building"
description: "Meet the batteries-included, full-stack framework for Bun that lets you ship faster. No configuration, no build step, no glue code—just one language and a direct path from idea to production."
date: 2026-07-31
category: Announcements
order: 1
---

# Zerotal: Stop Wiring, Start Building

Think about the last time you started a new project.

You picked a router. Then an ORM that had never heard of it. You chose a validation library with its own error shape and taught your router how to translate it. You grabbed an auth package that assumed a session store you hadn't picked yet, so you picked one and wrote the adapter code.

Somewhere around day three, you finally had a migration tool, a queue, a mailer, and a `lib/` directory full of small files whose only job was to introduce two libraries to each other.

None of that was your product. All of it became your maintenance burden.

What if you could skip all that? What if you could get straight to building?

**Zerotal** (ZEE-ro-tal) is the answer. It’s a batteries-included, full-stack framework built entirely on Bun, where the whole application layer arrives on day one, fully integrated and ready to go.

```bash
bun create zerotal my-app
cd my-app && bun dev
```

Thirty seconds later, you have a running application with routing, an ORM, migrations, sessions, validation, a queue, and a dev server with hot reload. You've written no configuration, because there is none to write.

## Zero to Total: The Philosophy

The name is the entire argument.

**Zero** — Zero configuration. Zero glue code. Zero build step. Zero context-switching between different languages.

**Total** — A total framework. Not a router you assemble a framework around, but a complete, cohesive system.

We provide twenty-two first-party packages, all designed to work together seamlessly, not just discovered separately on npm:

|                |                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Data**       | A powerful ORM with relations, scopes, and factories. Plus migrations, a query builder, and seeding.                 |
| **Security**   | Robust auth with guards and policies, sessions, CSRF protection, encryption, 2FA, and OAuth.                         |
| **Work**       | Background queues with batches and retries, a task scheduler, caching, and distributed locks.                        |
| **Interface**  | Server-rendered JSX, **Flow** (our server-driven UI solution), Inertia for React/Vue, and a themeable component kit. |
| **Operations** | Structured logging, telemetry, health checks, a monitor dashboard, audit trails, and multi-tenancy.                  |
| **Reach**      | Built-in i18n, notifications via mail, SMS, & Slack, and WebSocket broadcasting.                                     |

The point isn't the list itself. The point is that **you didn't have to choose any of it**. They all agree on what a request is, what a model is, and where a config value comes from, right out of the box.

## What "No Glue Code" Actually Feels Like

Here is a complete feature—a paginated, authenticated, validated resource—in just three small files:

```ts
// app/models/Post.ts
@table("posts")
export class Post extends Model.using(SoftDeletes) {
  static override fillable = ["title", "body"];

  @column() title!: string;
  @column("text") body!: string;
  @belongsTo() author!: User;
}
```

```ts
// app/requests/StorePostRequest.ts
export class StorePostRequest extends FormRequest {
  rules(rule: RuleBuilder) {
    return {
      title: rule.required().min(3).max(120),
      body: rule.required(),
    };
  }
}
```

```ts
// app/controllers/PostController.ts
export class PostController extends Controller {
  async index(http: HttpContext) {
    const posts = await Post.query().with("author").latest().paginate();
    return http.json({ posts });
  }

  async store(http: HttpContext) {
    const data = await StorePostRequest.validate();
    const post = await Post.create({ ...data, authorId: http.user.id });
    return redirect(`/posts/${post.slug}`);
  }
}
```

Now, count what’s missing: No `PostModule` or `container.register(Post)`. No DTO mirroring the model. No separate serializer. No `zod` schema to maintain in a second place. No route file listing every handler. No `tsconfig` path aliases to make the imports resolve. No build config.

It just works. `Post.create()` automatically refuses attributes not listed in `fillable`, preventing mass-assignment vulnerabilities. `paginate()` returns rich metadata and URL helpers, not just raw data. `redirect()` knows about your session's flash bag. This isn’t wiring you did; it’s intelligence built into the framework.

## The Power of Laravel, Reimagined in TypeScript

If you've ever shipped a project with Laravel or Django, the mental model transfers almost one-to-one: service providers, Active Record models, form requests, queues, and policies. These conventions made teams productive for a decade, and they were never the problem.

The problem, for a team whose front end is React or Vue, was the context switch. You’d write validation rules twice. You’d describe the same model shape twice. You’d name the routes twice, in two different languages, and pray the two halves stayed in sync.

Zerotal keeps the battle-tested conventions and deletes the seam. **One language, front to back.** The type that leaves your controller is the exact same type your page receives. Renaming a field is a simple compiler error, not a mysterious production bug.

## There Is No Build Step

Not "a fast build step." **None.**

Zerotal packages ship as TypeScript source. Bun executes and type-strips `.ts` files directly, so there’s nothing to compile—not for your application, and not for the framework itself. That means no bundler config, no `ts-node`, no `tsconfig` archaeology, and no test runner to configure.

What you write is what runs. Drop a component in `app/flow/pages/` and it becomes a route. Add a model to `app/models/` and it's instantly registered. When something throws an error, the stack trace points to the real, commented source code you can actually read and understand.

We wrote a whole post about the [trade-offs of this approach](/blog/no-build-step), but the result is an immediacy that has to be felt to be believed.

## And Then There Is Flow: Server-Driven UI, Simplified

Most interactive features require three artifacts: a server endpoint, a client-side state manager, and the API contract between them.

Flow collapses that entire stack into a single class.

```tsx
export class Counter extends Component {
  @expose count = 0;

  @expose increment(): void {
    this.count++;
  }

  override async render() {
    return (
      <div>
        <p>Count: {this.count}</p>
        <button onClick={this.increment}>+1</button>
        <button onClick={() => this.count--}>−1</button>
      </div>
    );
  }
}
```

State lives on the server, where it belongs. Calling `this.increment` automatically round-trips to the server and streams a minimal DOM patch back. For simple client-side-only interactions, an arrow function like `() => this.count--` is compiled to a client expression and never touches the network. You choose the right tool for the job, interaction by interaction.

No API. No client store. No `fetch`. It’s the holy grail of productivity. [Read the deep dive on Flow.](/blog/flow-server-driven-ui)

## Our Commitment to Transparency

This is our first public release, but it’s real, production-ready code backed by **5,670 tests**. We snapshot our public API surface on every change and ratchet our quality baselines.

We’re also honest about where each package stands. You’ll find a maturity level in every `package.json` and in our docs:

- **Stable (10 packages)**: core, ORM, auth, sessions, cache, queue, scheduler, client, validator, testing. The public API follows semver strictly.
- **Beta (7)**: audit, broadcasting, i18n, inertia, notifications, telemetry, tenancy. Working and tested, but the surface may still move.
- **Experimental (5)**: Flow, flow-ui, admin, devtools, monitor. The most exciting parts, and the ones most likely to change.

We’d rather tell you plainly that Flow is experimental than paint a uniform "1.0" across the whole surface and have you discover the reality in production.

## Your Next Project Starts Now

It’s time to spend less time configuring and more time building.

```bash
bun create zerotal my-app
```

Pick a template—API, Admin, Flow, React, Vue, or Minimal—and you’ll have a working application before your coffee cools.

- **[Getting Started](/docs/getting-started)** — Go from zero to a deployed app in fifteen minutes.
- **[About Zerotal](/docs/about)** — See the entire framework on one page, with runnable examples.
- **[Conventions](/docs/conventions)** — Learn the "magic" behind Zerotal's auto-discovery.

The framework you assemble is never the framework you wanted. Start from total instead.

**Zero to total.**
