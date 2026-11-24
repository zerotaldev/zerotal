import { ServiceProvider, config } from "zerotal";
import { Inertia } from "@zerotal/inertia";

/**
 * The app's own provider. Anything under app/providers/ is registered on its own, after
 * the framework providers in bootstrap/providers.ts, so nothing has to list it.
 *
 * It shares the props every page reads besides the built-in `auth`, `flash`, `errors`
 * and `old`. Add yours here, and to `SharedProps` in resources/js/types.ts.
 */
export class AppServiceProvider extends ServiceProvider {
  override async onBooted(): Promise<void> {
    Inertia.share({
      // Read per request rather than once, so a test or a config reload sees the
      // current value.
      app: () => ({ name: config("app.name") }),
    });
  }
}
