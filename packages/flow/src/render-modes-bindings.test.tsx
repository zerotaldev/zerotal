/** @jsxImportSource @zerotal/flow */
/**
 * A binding on a static component is an error in development.
 *
 * `onClick={this.bump}` on a `static interactive = false` page rendered
 * `flow:click="bump"`, and clicking it did nothing. A static page is never
 * registered with the client, so the click found no component to send to, and
 * neither the server nor the browser said anything. These pin the refusal, and
 * just as much the cases it must leave alone: a static child of an interactive
 * parent binds through the parent, and an island's bindings are its own.
 */
import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import { Container, HttpContext, RequestContext, ScopedResolver } from "@zerotal/core";
import { Component } from "./Component.ts";
import { expose, on } from "./decorators.ts";
import { _makeFlowHandler } from "./router.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

const savedNodeEnv = Bun.env.NODE_ENV;
afterEach(() => {
  if (savedNodeEnv === undefined) delete Bun.env.NODE_ENV;
  else Bun.env.NODE_ENV = savedNodeEnv;
});

/** Run a page through its real route handler and return the response body. */
async function get(PageClass: unknown): Promise<string> {
  const ctx = new HttpContext(
    new Request("http://localhost/p"),
    new ScopedResolver(new Container()),
  );
  const Handler = _makeFlowHandler("/p", PageClass as never);
  await RequestContext.run(ctx, () => new Handler().handle(ctx));
  return ctx.response!.text();
}

class Counter extends Component {
  @expose count = 0;
  @expose bump(): void {
    this.count += 1;
  }
  override async render() {
    return (
      <button id="island" type="button" onClick={this.bump}>
        {this.count}
      </button>
    );
  }
}

class DeadClickPage extends Component {
  static override interactive = false;
  @expose bump(): void {}
  override async render() {
    return (
      <button type="button" onClick={this.bump}>
        dead
      </button>
    );
  }
}

class DeadModelPage extends Component {
  static override interactive = false;
  @expose name = "";
  override async render() {
    return <input value={this.name} />;
  }
}

/** Static, and binding — but rendered by an interactive parent, whose client acts on it. */
class StaticButton extends Component {
  static override interactive = false;
  @expose bump(): void {}
  override async render() {
    return (
      <button id="delegated" type="button" onClick={this.bump}>
        +
      </button>
    );
  }
}

describe("a binding on a static component", () => {
  it("is refused on a static page", async () => {
    await expect(get(DeadClickPage)).rejects.toThrow(
      /<button onClick=\{…\}> in <DeadClickPage>.*static interactive = false/s,
    );
  });

  it("is refused for a model binding too", async () => {
    await expect(get(DeadModelPage)).rejects.toThrow(/renders flow:model/);
  });

  it("is refused on a static child of a static page", async () => {
    class Page extends Component {
      static override interactive = false;
      override async render() {
        return <main>{await this.child(StaticButton)}</main>;
      }
    }
    await expect(get(Page)).rejects.toThrow(/in <StaticButton>/);
  });

  it("is allowed on a static child of an interactive parent", async () => {
    class Page extends Component {
      @expose bump(): void {}
      override async render() {
        return <main>{await this.child(StaticButton)}</main>;
      }
    }
    expect(await get(Page)).toContain('flow:click="bump"');
  });

  it("is allowed on an island of a static page", async () => {
    class Page extends Component {
      static override interactive = false;
      override async render() {
        return <main>{await this.child(Counter)}</main>;
      }
    }
    const body = await get(Page);
    expect(body).toContain('flow:click="bump"');
    expect(body).toContain("data-flow-page");
  });

  it("is not checked in production", async () => {
    Bun.env.NODE_ENV = "production";
    expect(await get(DeadClickPage)).toContain('flow:click="bump"');
  });
});

describe("an @on listener on a static component", () => {
  it("is refused, since no event can reach it", async () => {
    class Page extends Component {
      static override interactive = false;
      @on("post-created") reload(): void {}
      override async render() {
        return <main>static</main>;
      }
    }
    await expect(get(Page)).rejects.toThrow(/declares @on\("post-created"\) on reload\(\)/);
  });

  it("is refused on a static child even under an interactive parent", async () => {
    class Listener extends Component {
      static override interactive = false;
      @on("post-created") reload(): void {}
      override async render() {
        return <aside>static</aside>;
      }
    }
    class Page extends Component {
      override async render() {
        return <main>{await this.child(Listener)}</main>;
      }
    }
    await expect(get(Page)).rejects.toThrow(/<Listener> is `static interactive = false`/);
  });
});

describe("a static page", () => {
  it("is wrapped in a page marker that is not a flow root", async () => {
    class Page extends Component {
      static override interactive = false;
      override async render() {
        return <main id="m">hello</main>;
      }
    }
    const body = await get(Page);
    // Client navigation swaps this element. Without it the swap took the first
    // `[data-flow-root]`, which on a static page is an island.
    expect(body).toContain('<div data-flow-page><main id="m">hello</main></div>');
    expect(body).not.toContain("data-flow-root");
  });
});
