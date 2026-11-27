import { Application, basePath, env } from "zerotal";
import { CsrfMiddleware } from "zerotal/session";
import providers from "./providers";
import { Handler } from "../app/exceptions/Handler";
import type { User } from "../app/models/User.ts";

// Tell @zerotal/auth which model `Auth.user()` returns — and so `http.user`, and a
// Flow page's `this.user`. The empty body is the point: this augmentation exists to
// bind the type, not to add members.
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
  // Refuses a POST, PUT, PATCH or DELETE that does not carry this session's token, with a
  // 419: another site cannot make a signed-in browser submit one of these forms. Every form
  // in app/flow/ carries the token in a hidden field, `{CsrfMiddleware.field()}`; a script
  // sends the XSRF-TOKEN cookie's value back as the X-XSRF-TOKEN header instead.
  .use([CsrfMiddleware.with({ secure: env("APP_ENV", "development") === "production" })])
  // Renders 404s and other HTTP errors through app/flow/pages/error.tsx.
  .withExceptionHandler(Handler);

export default app;
