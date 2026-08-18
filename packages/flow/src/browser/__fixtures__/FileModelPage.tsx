/** @jsxImportSource @zerotal/flow */
/**
 * A file input bound with `flow:model`, and a server action that puts a
 * non-empty value on the bound property.
 *
 * That pairing is the whole point. A file input's `value` belongs to the user
 * agent: assigning anything but `""` throws `InvalidStateError`. The bridge
 * writes server state back into every bound input after a patch, so the moment
 * the property held a real upload reference the write-back threw — and because
 * the throw escaped the frame handler, the morph never ran and the action's ack
 * never resolved, wedging the component's queue. The page kept rendering and
 * stopped responding, with nothing in the console but one browser error.
 *
 * No upload plumbing here on purpose: storage and an authenticated session are
 * not what broke. A plain non-empty value on the bound property reproduces the
 * failure exactly, and does it in a second.
 */
import { Component } from "../../Component.ts";
import { expose } from "../../decorators.ts";

export class FileModelPage extends Component {
  /** Bound to the file input. A real page holds an upload reference here. */
  @expose doc = "";

  /** Anything that makes the server send a patch while `doc` is non-empty. */
  @expose stamp = "";

  @expose fill(): void {
    this.doc = "server-side-reference";
    this.stamp = "filled";
  }

  @expose mark(): void {
    this.stamp = "marked";
  }

  override async render() {
    return (
      <div>
        <input id="doc" type="file" value={this.doc} />
        <button id="fill" type="button" onClick={this.fill}>
          Fill
        </button>
        <button id="mark" type="button" onClick={this.mark}>
          Mark
        </button>
        <p id="stamp">{this.stamp}</p>
      </div>
    );
  }
}
