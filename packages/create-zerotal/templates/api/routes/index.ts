import { Router } from 'zerotal';
import { WelcomeController } from '../app/controllers/WelcomeController.ts';
import { AuthController }    from '../app/controllers/AuthController.ts';
import { RequireAuth }       from '../app/middleware/RequireAuth.ts';

/**
 * Every route this API serves.
 *
 * Exported as a function *and* called below, because the two callers need
 * different things. `bootstrap/app.ts` points `.routing()` at this file and
 * relies on importing it to register the routes — that is the call at the
 * bottom. Tests build their own application, and `createTestApp` resets the
 * router before handing control to its `setup` callback; re-importing this file
 * would not help, since a module's top-level code runs once per process. So the
 * suite calls `registerRoutes()` from that callback instead.
 */
export function registerRoutes(): void {
  // Public
  Router.get('/',          WelcomeController, 'index');
  Router.post('/register', AuthController,    'register');
  Router.post('/login',    AuthController,    'login');
  Router.post('/logout',   AuthController,    'logout');

  // Protected
  Router.get('/me', AuthController, 'me', [RequireAuth]);
}

registerRoutes();
