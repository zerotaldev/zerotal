import { Model, column, table } from "zerotal/orm";
import { Authenticatable } from "zerotal/auth";

/**
 * `Model.using(Authenticatable)`, not a plain `Model`.
 *
 * The mixin is what brands the class so `authUserModel()` can find it. Without
 * the brand nothing errors and nothing warns — the model saves, queries and
 * hashes exactly as before — but `Auth.attempt()` resolves *no* user model at
 * all and therefore returns `false` for every correct password, so no one can
 * ever sign in.
 *
 * It also supplies `getAuthId()` / `getAuthPassword()`, which the auth flow
 * reads, and registers the `rememberToken` column that "remember me" needs.
 */
@table("users")
export class User extends Model.using(Authenticatable) {
  // Models guard every attribute by default. Only these may be mass-assigned
  // from a request body — `role` is deliberately absent, so no amount of extra
  // fields in a form post can promote the account that submitted it.
  static override fillable = ["name", "email", "password"];

  // Never serialised into a rendered page or a JSON response.
  /**
   * Never serialized — and `rememberToken` matters as much as `password`.
   *
   * `@zerotal/inertia` shares the signed-in user with *every* page, through
   * `toJSON()`, which is what honours this list. A remember token left off it
   * is a live credential embedded in every authenticated page's JSON — and
   * cached in `history.state` alongside it, so it survives in the browser after
   * the tab has moved on. Anyone who has used "remember me" ships a working
   * login in their page source until this line is right.
   *
   * The scaffold ships `["password"]`. That is half the answer. See T20.
   */
  static override hidden = ["password", "rememberToken"];

  @column({ type: "string" }) name!: string;
  @column({ type: "string" }) email!: string;
  @column({ type: "string" }) password!: string;
  @column({ type: "string", nullable: true, default: "user" }) role?: string | undefined;

  /**
   * The language this person chose, or null if they never did.
   *
   * Not fillable: it is set by the settings route from a checked list, and a
   * locale arriving in a request body could otherwise name a catalog that does
   * not exist. Null means "resolve it from the request" — see
   * `UserLocaleMiddleware`.
   */
  @column({ type: "string", nullable: true }) locale?: string | null;
}
