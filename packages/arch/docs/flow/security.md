---
title: Flow Security
description: What Flow trusts from the browser, what it checks on every action, and what is left for your code to check.
---

# Flow security

A Flow page keeps its state in the browser between actions and runs its code on the server.
This page says what that arrangement protects on its own and where your code still has to
decide.

## The snapshot

After each render the server serialises the component's `@expose` and `@locked` fields into a
**snapshot** and sends it to the browser, which sends it back with the next action.

- **It is signed, not encrypted.** The snapshot carries an HMAC made with `APP_KEY`. The
  browser cannot change a value without the signature failing, but anyone can read every value
  in it. Do not put a secret in an `@expose` or `@locked` field: keep the id and load the
  record inside the action.
- **It belongs to one user.** A snapshot issued to a signed-in user is refused when anyone else
  sends it, and one issued to a guest is refused once that browser signs in. The browser is
  told to reload.
- **It expires after 12 hours.** A page left open longer reloads on its next action.
- **An older snapshot is still a valid one.** Nothing marks a snapshot as used, so a client can
  send back any snapshot it was given in the last 12 hours instead of the newest. `@locked`
  stops the browser changing a value; it does not stop it rewinding to an earlier one. State
  that must only move forward (attempts left, the step of a checkout, a balance) belongs in
  the database or the session, not only in a `@locked` field.

## What the browser can call and write

Nothing is reachable unless you opt in.

- **Methods:** only those marked `@expose` can be called. A call to any other name is refused
  and logged as a warning.
- **Fields:** only `@expose` fields can be written, through `flow:model` or `$set`. `@locked`
  fields travel in the snapshot and cannot be written. A `@reactive` prop on a child component
  is written by its parent on each render, and can also be written by the browser, so do not
  use one to carry an id the child trusts.
- **Arguments are client input.** `onClick={() => this.remove(post.id)}` sends the id from the
  browser, and a client can send any id. Check that the record belongs to the user inside the
  action, exactly as you would in a controller:

  ```typescript fragment
  @expose async remove(id: number): Promise<void> {
    const post = await Post.where("id", id).where("user_id", this.user.id).firstOrFail();
    await post.delete();
    this.refresh();
  }
  ```

- **`onMount()` can be asked for again.** The browser may send a refresh at any time, which
  runs `onMount()` once more. Use it to load state, not for an effect that must happen once
  (sending a mail, charging a card).

## What runs on every action

The middleware on the page's route runs again for each action, so a signed-out or unauthorised
user is stopped on the action, not only on the first page load. Global middleware runs again
only when it is listed as persistent. See
[What re-runs on a WebSocket action](/docs/flow#what-re-runs-on-a-websocket-action).

The socket upgrade and the HTTP fallback both check the request's `Origin` against the app's
own origin and `app.allowedOrigins`, so another site cannot drive a signed-in user's actions.

## Frames that are refused

A frame is checked in this order, and the first failure answers it:

| Check                                | Answer                 | Logged                   |
| ------------------------------------ | ---------------------- | ------------------------ |
| It has the shape of a call frame     | `Malformed frame`      | Warning, counted (below) |
| Its snapshot's signature verifies    | `Invalid snapshot`     | Warning, counted (below) |
| The page class is registered         | `Unknown component`    | No (the browser reloads) |
| Route and persistent middleware pass | A redirect or an error | By the middleware        |
| The snapshot belongs to this user    | Reload instruction     | No                       |
| The method is `@expose`d             | `Method … not allowed` | Warning                  |

A frame that fails one of the first two checks never reaches your middleware, starts no
session and loads no page.

### The invalid-frame count

Malformed frames and frames that do not verify are counted per client address, in ten-minute
windows, so that a client sending them in a loop cannot fill your log. The first ten in a
window are each logged as a warning. The eleventh logs one line saying the rest will be
refused quietly, and from then on that address is answered `Too many invalid requests` with
nothing logged, until the window ends.

**The count never refuses a frame that verifies.** A visitor with a valid page is served
however many bad frames came from the same address.

The address is the one the rest of the framework uses: the socket's, unless
`app.throttle.trustedProxies` says how many proxies sit in front of the app. Behind a reverse
proxy with that left unset, every client is counted under the proxy's address. Nobody is locked
out by that, but the log names the proxy instead of the client and one noisy client uses up
the ten warnings for all of them. Set it when a proxy fronts the app:

```typescript fragment
// config/app.ts
export default AppConfig({
  throttle: { trustedProxies: 1 },
});
```

[Client IP](/docs/context#client-ip) explains how the count is read.

## What a visitor sees when something throws

Flow catches an error thrown on a page so that the page stays usable. The error is always
reported: to the exception handler you registered with `app.withExceptionHandler()`, or to the
log when there is none. What the visitor is shown depends on where the app runs:

| Where the app runs                               | The visitor sees                          |
| ------------------------------------------------ | ----------------------------------------- |
| Development, `bun zt dev`, a test run            | The error's own message                   |
| Anywhere else                                    | "Something went wrong. Please try again." |
| An error raised to answer the client, everywhere | Its own message                           |

An error raised to answer the client is one thrown with `abort()` or a built-in HTTP error such
as `ForbiddenError`, with a status below 500. Everything else is treated as a fault whose text
was written for the log.

`flow.exposeErrorMessages` sets this for every environment:

```typescript fragment
// config/flow.ts
export default FlowConfig({
  exposeErrorMessages: true, // show every error's own message, everywhere
});
```

`true` is what Flow did before 1.18.4. `false` hides messages in development as well. To choose
the words for one component, override
[`onError()`](/docs/flow/lifecycle#custom-error-handling).

## Next steps

- [Lifecycle Hooks](/docs/flow/lifecycle) for `onError()` and the order hooks run in.
- [Decorators](/docs/flow/decorators) for `@expose`, `@locked` and `@reactive`.
- [Testing](/docs/flow/testing) for asserting on refusals and errors.
