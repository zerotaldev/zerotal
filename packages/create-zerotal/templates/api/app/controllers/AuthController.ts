import type { HttpContext } from 'zerotal';
import { Hash } from 'zerotal/auth';
import { User } from '../models/User.ts';

export class AuthController {
  /** POST /register */
  async register(http: HttpContext): Promise<void> {
    const body = await http.request.json() as Record<string, string>;
    const { name, email, password } = body;

    if (!name || !email || !password) {
      http.response = Response.json({ message: 'name, email, and password are required.' }, { status: 422 });
      return;
    }

    const exists = await User.query().where('email', email).first();
    if (exists) {
      http.response = Response.json({ message: 'Email already in use.' }, { status: 422 });
      return;
    }

    // `role` is not in `fillable`, so it cannot be mass-assigned — passing it to
    // create() is refused outright, which is the guard doing its job. Setting it
    // here, in code, is the point: a value the request can never influence.
    const user = new User();
    user.name = name;
    user.email = email;
    user.password = await Hash.make(password);
    user.role = 'user';
    await user.save();

    http.session?.set('user_id', user.id);
    http.response = Response.json({ data: { id: user.id, name: user.name, email: user.email } }, { status: 201 });
  }

  /** POST /login */
  async login(http: HttpContext): Promise<void> {
    const body     = await http.request.json() as Record<string, string>;
    const email    = body.email?.trim() ?? '';
    const password = body.password ?? '';

    if (!email || !password) {
      http.response = Response.json({ message: 'email and password are required.' }, { status: 422 });
      return;
    }

    const user = await User.query().where('email', email).first();
    if (!user || !(await Hash.check(password, user.password))) {
      http.response = Response.json({ message: 'Invalid credentials.' }, { status: 401 });
      return;
    }

    http.session?.set('user_id', user.id);
    http.response = Response.json({ data: { id: user.id, name: user.name, email: user.email } });
  }

  /** POST /logout */
  async logout(http: HttpContext): Promise<void> {
    http.session?.forget('user_id');
    http.response = Response.json({ message: 'Logged out.' });
  }

  /** GET /me */
  async me(http: HttpContext): Promise<void> {
    if (!http.user) {
      http.response = Response.json({ message: 'Unauthenticated.' }, { status: 401 });
      return;
    }
    const user = await User.findOrFail(http.user.id as number);
    http.response = Response.json({ data: { id: user.id, name: user.name, email: user.email } });
  }
}
