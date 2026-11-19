import { Model, column, table } from 'zerotal/orm';
import { Authenticatable } from 'zerotal/auth';

/**
 * `Model.using(Authenticatable)`, not a plain `Model`.
 *
 * The mixin is what brands the class so `authUserModel()` can find it. Without
 * the brand nothing errors and nothing warns at sign-in — the controller sets
 * `user_id` in the session as usual — but AuthProvider then resolves *no* user
 * model for the next request, so `http.user` stays empty and `GET /me` answers
 * 401 to everyone who just logged in.
 *
 * It also supplies `getAuthId()` / `getAuthPassword()`, which the auth flow
 * reads, and registers the `rememberToken` column.
 */
@table('users')
export class User extends Model.using(Authenticatable) {
  // Models guard every attribute by default. List the columns that may be
  // mass-assigned from user input — note `role` is deliberately excluded so a
  // request body cannot escalate privileges via `User.create(ctx.body())`.
  static override fillable = ['name', 'email', 'password'];

  static override hidden = ['password'];

  @column({ type: 'string' }) name!:     string;
  @column({ type: 'string' }) email!:    string;
  @column({ type: 'string' }) password!: string;
  @column({ type: 'string', nullable: true, default: 'user' }) role?: string | undefined;
}
