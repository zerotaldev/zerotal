import { Router } from "../Router.ts";

export class HealthController {
  static register(): void {
    Router.get("/health-fixture", HealthController, "index");
  }
  index(): void {}
}
