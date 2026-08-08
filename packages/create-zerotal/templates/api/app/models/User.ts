import { BaseModel, column, table } from 'zerotal/orm';

@table('users')
export class User extends BaseModel {
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
