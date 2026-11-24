/**
 * What a full-stack starter kit contains, independent of the frontend it is written in.
 *
 * The React kit is the reference. The Vue and Flow kits are ports of it, and this list is
 * how a port is checked for completeness: the same pages, the same named routes at the same
 * paths and verbs, the same components, and the same tests under the same names. Nothing in
 * it is specific to one frontend — a page is named the way `Inertia.render()` (or a Flow
 * page path) names it, and a component by its export name.
 *
 * `templates.test.ts` asserts that the React kit has every entry. When a kit gains a page,
 * a route, a component or a test, it gains a line here first.
 */

/** A named route, as `types/routes.generated.ts` records it. */
export interface ManifestRoute {
  readonly name: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
}

/** A test file, and the test names it must contain. */
export interface ManifestTest {
  /** Path under `tests/`, without the extension. */
  readonly file: string;
  /** `describe` / `test` names, verbatim. */
  readonly names: readonly string[];
}

export interface KitManifest {
  /** Page components, as the server names them when it renders one. */
  readonly pages: readonly string[];
  /** Shells a page renders inside. */
  readonly layouts: readonly string[];
  /** Shared UI components, by export name. */
  readonly components: readonly string[];
  readonly routes: readonly ManifestRoute[];
  readonly tests: readonly ManifestTest[];
}

export const MANIFEST: KitManifest = {
  pages: [
    'home',
    'about',
    'contact',
    'error',
    'login',
    'register',
    'forgot-password',
    'reset-password',
    'profile',
  ],

  layouts: ['AppLayout'],

  components: ['Button', 'Card', 'Code', 'Field', 'FlashToasts', 'Icons', 'ThemeToggle'],

  routes: [
    { name: 'home', method: 'GET', path: '/' },
    { name: 'about', method: 'GET', path: '/about' },
    { name: 'contact', method: 'GET', path: '/contact' },
    { name: 'contact.store', method: 'POST', path: '/contact' },
    { name: 'login', method: 'GET', path: '/login' },
    { name: 'login.store', method: 'POST', path: '/login' },
    { name: 'logout.store', method: 'POST', path: '/logout' },
    { name: 'register', method: 'GET', path: '/register' },
    { name: 'register.store', method: 'POST', path: '/register' },
    { name: 'forgot-password', method: 'GET', path: '/forgot-password' },
    { name: 'forgot-password.store', method: 'POST', path: '/forgot-password' },
    { name: 'reset-password', method: 'GET', path: '/reset-password' },
    { name: 'reset-password.store', method: 'POST', path: '/reset-password' },
    { name: 'profile', method: 'GET', path: '/profile' },
    { name: 'profile.store', method: 'POST', path: '/profile' },
    { name: 'profile.password.store', method: 'POST', path: '/profile/password' },
  ],

  tests: [
    {
      file: 'smoke.test',
      names: [
        'boots and serves the home page',
        'shares the app name from config with every page',
        'returns 404 for an unregistered path',
      ],
    },
    { file: 'pages.test', names: ['pages render'] },
  ],
};
