import { Component } from "../../../../../Component.ts";
import type { HtmlNode } from "../../../../../jsx-runtime.ts";

/** Compiled ahead of time by `bun zt compile`; its JSX needs this app's tsconfig. */
export class HomePage extends Component {
  async render(): Promise<HtmlNode> {
    return <p id="probe">a compiled page</p>;
  }
}
