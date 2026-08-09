---
title: "The Case of the Vanishing @expose"
description: "A build error insisted an action was not @exposed. It was. The trail led out of the framework, through a fifteen-line repro with no Zerotal code in it, to a decorator defect in the runtime itself — and to how a framework should behave when the ground moves."
date: 2026-08-10
category: Engineering
order: 2
---

# The Case of the Vanishing @expose

While building 1.3.0's `Component.using(...)`, we wrote a test that should have been boring. A base page with an exposed action, a subclass composing a mixin onto it, an assertion that the action is registered:

```ts
abstract class AdminPage extends Component {
  @expose breadcrumb = "admin";
  @expose guard(): string {
    return "allowed";
  }
}

class DashboardPage extends AdminPage.using(Pagination) {
  @expose heading = "Dashboard";
  // …
}

expect(getExposedMethods(DashboardPage).has("guard")).toBe(true); // ❌ false
```

`guard` was gone. Not broken — the method itself ran fine when called. It had vanished from the framework's _registry_ of exposed methods, which is the allowlist that decides what the browser may invoke. And since 1.1.0 made the un-`@expose`d-action check fatal — because a silently refused click is the worst kind of bug — a page composed like this would reject its own legitimate button at build time, with an error pointing at entirely the wrong cause.

This matters beyond one test. Exposed methods are Flow's security boundary. A registry that quietly loses entries is a correctness bug wearing a security feature's clothes.

## Suspect number one: our own code

The obvious culprit was the code we had just written. Failing that, the next suspect was the field-decorator buffer — a documented workaround Zerotal already carries, because Bun's handling of standard _field_ decorators cross-wires initializers between classes in the same file. Machinery with a history is machinery you suspect.

Both alibis held. The failure reproduced with **no mixin anywhere**:

```ts
abstract class Base extends Component {
  @expose guard(): string {
    return "x";
  }
}
class Sub extends Base {
  @expose title = "D"; // ← this line is the trigger
}
// getExposedMethods(Sub) → []   — guard is gone
```

Remove the subclass's decorated _field_ and `guard` comes back. The shape table, once we mapped it, was damning:

| Shape                                            | Registry                              |
| ------------------------------------------------ | ------------------------------------- |
| base `@expose` method + subclass `@expose` field | `[]` — **method lost**                |
| base `@expose` method, subclass has no field     | `["guard"]` ✓                         |
| single class, own field + own method             | `["act"]` ✓                           |
| base method + subclass field + subclass method   | `["act"]` — base's lost, own survives |

## Suspect number two: nobody we know

The decisive step was instrumenting the decorator itself — logging when it is _applied_ and when its `addInitializer` callback _runs_. The application always logged. The initializer, in the failing shape, never ran. Not late, not on the wrong prototype — never.

That pointed at the lowering, not the framework. So: fifteen lines, pure TC39 standard decorators, zero Zerotal imports, run directly on Bun 1.3.14. Same result. **A method decorator's `addInitializer` callbacks do not run for a class whose subclass declares a decorated field.** Every decorator Zerotal registers through that mechanism was affected — `@expose` on methods, `@task`, `@renderless`, `@on`, `@computed`.

Two lessons from the hunt worth keeping. First, _instrument before you theorize_: our first hypothesis (the drain buffer) was confident, plausible, and wrong, and ten minutes of logging beat an afternoon of reading. Second, _the minimal repro is the verdict_: the moment the bug reproduced with no framework code, the question changed from "what did we break" to "what do we do about the runtime".

## Fixing on ground you don't control

We ship on Bun by choice and the trade is documented honestly elsewhere on this blog: no build step, native speed, one runtime — and occasionally, new terrain. Standard decorators are young everywhere. A framework that adopts a young platform owes its users the workarounds, not the excuses.

The fix removes the dependency on `addInitializer` entirely. A method or getter decorator's _body_ always runs, at class-definition time, with the correct name — so that is where the truth now lives. Each decorator tags the function object it is handed (a symbol-keyed, non-enumerable mark on the function itself), and the registry readers scan the prototype chain for tagged members on first read, registering each one against its **declaring** prototype:

```ts
// decorator body — always runs
_tag(method, { exposed: true });

// first read — walk the chain, collect tags where they were declared
_scanChain(PageClass.prototype);
```

Registering on the declaring prototype is what makes inheritance fall out for free: the existing chain-walking collectors already merge ancestors, so a base's action is visible to every subclass without any subclass ever being constructed. `addInitializer` stays wired up as a belt-and-braces fallback — it is harmless when it fires and covers anything a prototype scan cannot see.

The workaround made two things _better_ than they were:

- **Registration no longer requires an instance.** The old path only learned about a class when something constructed it; `getExposedMethods()` on a never-instantiated class returned an empty set. Now it is correct immediately.
- **Sibling subclasses stopped cross-registering.** Entries used to land on whichever subclass was constructed first; they now land where the member is declared, so `A` never sees `B`'s actions.

All of it is pinned by a regression suite that exercises every affected decorator through the failing shapes — including the one where an undecorated override must _not_ inherit its base's tag — so if a future Bun fixes the lowering, the tests keep passing; and if a future Bun breaks it differently, they fail loudly instead of letting an allowlist rot.

## The posture

Frameworks on young runtimes accumulate scar tissue. The question is whether it is _organized_ scar tissue: the field-decorator buffer has a header comment explaining exactly which runtime behaviour it routes around; this fix now sits beside it with the same paper trail; both are covered by tests that describe the world as it is, not as the spec says it should be.

Your `@expose` on a shared page base works now, whatever fields your subclasses declare. That is the whole contract — and it shipped in 1.3.0.
