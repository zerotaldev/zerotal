/** @jsxImportSource @zerotal/flow */
/** A Flow page reached through file routing, for the group-middleware test. */
import { Component } from "../../../Component.ts";

export default class InvoicesPage extends Component {
  override async render() {
    return <p id="invoices">invoices</p>;
  }
}
