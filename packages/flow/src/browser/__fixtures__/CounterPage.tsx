/** @jsxImportSource @zerotal/flow */
/**
 * The page the browser harness drives.
 *
 * Deliberately ordinary: a server action behind a button, a `flow:model` text
 * input, and a value derived on the server from what was typed. Every one of
 * those is a link in the chain `FlowTest` cannot exercise — the click listener,
 * the model flush, the socket, the dispatcher, the patch — so an ordinary page
 * is exactly what proves the chain works.
 */
import { Component } from "../../Component.ts";
import { expose } from "../../decorators.ts";

export class CounterPage extends Component {
  @expose count = 0;
  @expose name = "";
  @expose greeting = "";

  @expose increment(): void {
    this.count += 1;
  }

  @expose greet(): void {
    // Derived on the server from the model-bound field, so a passing assertion
    // proves the typed value actually crossed the socket.
    this.greeting = this.name ? `Hello, ${this.name}!` : "(nobody)";
  }

  override async render() {
    return (
      <div>
        <p id="count">{this.count}</p>
        <button id="increment" type="button" onClick={this.increment}>
          Increment
        </button>

        <input id="name" value={this.name} />
        <button id="greet" type="button" onClick={this.greet}>
          Greet
        </button>
        <p id="greeting">{this.greeting}</p>
      </div>
    );
  }
}
