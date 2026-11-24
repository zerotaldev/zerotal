import { Application, basePath } from "zerotal";
import providers from "./providers";
import { Handler } from "../app/exceptions/Handler";
import type { User } from "../app/models/User.ts";

// Tell @zerotal/auth which model `Auth.user()` returns. The empty body is the
// point: this augmentation exists to bind the type, not to add members.
declare module "zerotal/auth" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface UserModel extends User {}
}

const app = Application.create({ providers })
  // The pages: one Flow component per screen, each at its URL and name.
  .routing({
    web: basePath("routes/web.ts"),
  })
  // What the pages' forms send, and the JSON endpoints — the file path is the URL.
  .fileBasedRouting({
    web: basePath("app/routes"),
  })
  // Renders 404s and other HTTP errors through app/flow/pages/error.tsx.
  .withExceptionHandler(Handler);

export default app;
