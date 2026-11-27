/** @jsxImportSource @zerotal/flow */
/**
 * A page whose render can be made to throw, for the browser's side of an error frame.
 *
 * A throw in `render()` happens outside the action body, so `onError()` does not see it and the
 * error frame is all the browser gets: the case that used to reach `console.error` and nothing
 * else.
 */
import { Component } from "../../Component.ts";
import { expose } from "../../decorators.ts";

export class FailingPage extends Component {
  @expose count = 0;
  @expose broken = false;

  @expose increment(): void {
    this.count += 1;
  }

  @expose breakRender(): void {
    this.broken = true;
  }

  override async render() {
    if (this.broken) throw new Error("render failed on purpose");
    return (
      <div>
        <p id="count">{this.count}</p>
        <button id="increment" type="button" onClick={this.increment}>
          Increment
        </button>
        <button id="break" type="button" onClick={this.breakRender}>
          Break
        </button>
      </div>
    );
  }
}
