/**
 * What a full-stack starter kit contains, independent of the frontend it is written in.
 *
 * The React kit is the reference. The Vue and Flow kits are ports of it, and this list is
 * how a port is checked for completeness: the same pages, the same named routes at the same
 * paths and verbs, the same components, and the same tests under the same names. Nothing in
 * it is specific to one frontend — a page is named the way `Inertia.render()` (or a Flow
 * page path) names it, and a component by its export name.
 *
 * `templates.test.ts` asserts that every kit in {@link KITS} has every entry. When a kit gains
 * a page, a route, a component or a test, it gains a line here first.
 */

/**
 * The full-stack kits: where each keeps its pages, layouts and components, and the
 * extension they are written in. A page is `<pages>/<name><extension>`, a layout
 * `<layouts>/<Name><extension>`, and a component `<components>/<Name><extension>`.
 *
 * The React and Vue kits keep the frontend under resources/js/. The Flow kit's pages and
 * components run on the server, so they live under app/flow/.
 */
export const KITS = {
  react: {
    extension: '.tsx',
    pages: 'resources/js/pages',
    layouts: 'resources/js/Layouts',
    components: 'resources/js/Components',
  },
  vue: {
    extension: '.vue',
    pages: 'resources/js/pages',
    layouts: 'resources/js/Layouts',
    components: 'resources/js/Components',
  },
  flow: {
    extension: '.tsx',
    pages: 'app/flow/pages',
    layouts: 'app/flow/layouts',
    components: 'app/flow/components',
  },
} as const;

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
    // Public
    'home',
    'about',
    'contact',
    'error',
    // Signing in
    'auth/login',
    'auth/register',
    'auth/forgot-password',
    'auth/reset-password',
    'auth/two-factor-challenge',
    'auth/verify-email',
    'auth/confirm-password',
    // Signed in
    'dashboard',
    'projects/index',
    'projects/create',
    'projects/edit',
    'settings/profile',
    'settings/password',
    'settings/appearance',
    'settings/two-factor',
    'settings/passkeys',
    'settings/sessions',
    'settings/delete-account',
  ],

  layouts: ['AppLayout', 'AuthLayout', 'PublicLayout', 'SettingsLayout'],

  components: [
    'Alert',
    'AppLogo',
    'Avatar',
    'Badge',
    'Button',
    'Card',
    'Checkbox',
    'Code',
    'Dropdown',
    'EmptyState',
    'Field',
    'Icon',
    'Input',
    'Modal',
    'PageHeader',
    'Pagination',
    'PasswordDialog',
    'ProjectForm',
    'ProjectStatusBadge',
    'Select',
    'SocialButtons',
    'ThemeToggle',
    'Toasts',
  ],

  routes: [
    // Public
    { name: 'home', method: 'GET', path: '/' },
    { name: 'about', method: 'GET', path: '/about' },
    { name: 'contact', method: 'GET', path: '/contact' },
    { name: 'contact.store', method: 'POST', path: '/contact' },
    // Signing in
    { name: 'login', method: 'GET', path: '/login' },
    { name: 'login.store', method: 'POST', path: '/login' },
    { name: 'register', method: 'GET', path: '/register' },
    { name: 'register.store', method: 'POST', path: '/register' },
    { name: 'forgot-password', method: 'GET', path: '/forgot-password' },
    { name: 'forgot-password.store', method: 'POST', path: '/forgot-password' },
    { name: 'reset-password', method: 'GET', path: '/reset-password' },
    { name: 'reset-password.store', method: 'POST', path: '/reset-password' },
    { name: 'two-factor.challenge', method: 'GET', path: '/two-factor/challenge' },
    { name: 'two-factor.challenge.store', method: 'POST', path: '/two-factor/challenge' },
    { name: 'passkeys.login.options.store', method: 'POST', path: '/passkeys/login/options' },
    { name: 'passkeys.login.store', method: 'POST', path: '/passkeys/login' },
    { name: 'social.redirect', method: 'GET', path: '/auth/:provider' },
    { name: 'social.callback', method: 'GET', path: '/auth/:provider/callback' },
    { name: 'social.callback.store', method: 'POST', path: '/auth/:provider/callback' },
    // Signed in
    { name: 'logout.store', method: 'POST', path: '/logout' },
    { name: 'verify-email', method: 'GET', path: '/verify-email' },
    { name: 'verify-email.store', method: 'POST', path: '/verify-email' },
    { name: 'verify-email.verify', method: 'GET', path: '/verify-email/:token' },
    { name: 'confirm-password', method: 'GET', path: '/confirm-password' },
    { name: 'confirm-password.store', method: 'POST', path: '/confirm-password' },
    { name: 'dashboard', method: 'GET', path: '/dashboard' },
    // The example resource
    { name: 'projects', method: 'GET', path: '/projects' },
    { name: 'projects.store', method: 'POST', path: '/projects' },
    { name: 'projects.create', method: 'GET', path: '/projects/create' },
    { name: 'projects.edit', method: 'GET', path: '/projects/:project/edit' },
    { name: 'projects.update', method: 'PUT', path: '/projects/:project' },
    { name: 'projects.destroy', method: 'DELETE', path: '/projects/:project' },
    // Settings
    { name: 'settings', method: 'GET', path: '/settings' },
    { name: 'settings.profile', method: 'GET', path: '/settings/profile' },
    { name: 'settings.profile.update', method: 'PATCH', path: '/settings/profile' },
    { name: 'settings.password', method: 'GET', path: '/settings/password' },
    { name: 'settings.password.update', method: 'PUT', path: '/settings/password' },
    { name: 'settings.appearance', method: 'GET', path: '/settings/appearance' },
    { name: 'settings.two-factor', method: 'GET', path: '/settings/two-factor' },
    { name: 'settings.two-factor.store', method: 'POST', path: '/settings/two-factor' },
    { name: 'settings.two-factor.destroy', method: 'DELETE', path: '/settings/two-factor' },
    { name: 'settings.two-factor.confirm.store', method: 'POST', path: '/settings/two-factor/confirm' },
    {
      name: 'settings.two-factor.recovery-codes.store',
      method: 'POST',
      path: '/settings/two-factor/recovery-codes',
    },
    { name: 'settings.passkeys', method: 'GET', path: '/settings/passkeys' },
    { name: 'settings.passkeys.store', method: 'POST', path: '/settings/passkeys' },
    { name: 'settings.passkeys.options.store', method: 'POST', path: '/settings/passkeys/options' },
    { name: 'settings.passkeys.destroy', method: 'DELETE', path: '/settings/passkeys/:passkey' },
    { name: 'settings.sessions', method: 'GET', path: '/settings/sessions' },
    { name: 'settings.sessions.destroy', method: 'DELETE', path: '/settings/sessions' },
    { name: 'settings.delete-account', method: 'GET', path: '/settings/delete-account' },
    { name: 'settings.delete-account.destroy', method: 'DELETE', path: '/settings/delete-account' },
  ],

  tests: [
    {
      file: 'smoke.test',
      names: [
        'boots and serves the home page',
        'shares the app name from config with every page',
        'serves a health check at /health',
        'returns 404 for an unregistered path',
      ],
    },
    { file: 'pages.test', names: ['pages render', 'pages render for a signed-in user'] },
    {
      file: 'auth/registration.test',
      names: [
        'registers a new user, signs them in and emails a verification link',
        'refuses an address that is already registered',
        'rejects a password confirmation that does not match',
      ],
    },
    {
      file: 'auth/login.test',
      names: [
        'signs a user in and sends them to the dashboard',
        'rejects a wrong password without saying which field was wrong',
        'locks an address out after five failed attempts, and says for how long',
        'sends a signed-in user away from the sign-in form',
        'returns a guest to the page they asked for after sign-in',
        'signs the user out',
      ],
    },
    {
      file: 'auth/email-verification.test',
      names: [
        'keeps an unverified user out of the dashboard',
        'lets an unverified user reach settings, to fix a mistyped address',
        'sends the link again on request',
        'verifies the address from the emailed link',
        'rejects a link meant for someone else',
      ],
    },
    {
      file: 'auth/password-reset.test',
      names: [
        'emails a reset link to a registered address',
        'answers the same for an unknown address',
        'resets the password with the emailed link',
        'rejects an invalid token',
      ],
    },
    {
      file: 'auth/confirm-password.test',
      names: [
        'asks for the password before two-factor settings',
        'lets the user through once the password is confirmed',
        'rejects a wrong password',
      ],
    },
    {
      file: 'auth/two-factor.test',
      names: [
        'turns two-factor on with a code from the app',
        'rejects a wrong code during setup, and saves nothing',
        'never shows the secret or the recovery codes to the page',
        'asks for a code at sign-in once two-factor is on',
        'signs in with a valid code',
        'rejects a wrong code',
        'signs in with a recovery code, which then stops working',
        'makes new recovery codes, and the old ones stop working',
        'turns two-factor off',
      ],
    },
    {
      file: 'auth/passkeys.test',
      names: [
        'hides passkeys while they are switched off',
        'issues a sign-in challenge when switched on',
        'issues a registration challenge to a signed-in user',
        'rejects an assertion for a passkey nobody registered',
      ],
    },
    {
      file: 'auth/social.test',
      names: [
        'offers no providers until their keys are set',
        'signs in a new user from a verified provider account',
        'links an existing verified account with the same email',
        'refuses to link an account whose email was never verified',
      ],
    },
    {
      file: 'settings/profile.test',
      names: [
        'updates the name',
        'changing the email asks for it to be verified again',
        'refuses an email another account uses',
      ],
    },
    {
      file: 'settings/password.test',
      names: [
        'changes the password, and the old one stops working',
        'keeps this browser signed in after the change',
        'refuses a wrong current password',
      ],
    },
    {
      file: 'settings/sessions.test',
      names: [
        'lists the browsers the user is signed in on',
        'signs out the other sessions, and keeps this one',
        'refuses without the password',
      ],
    },
    {
      file: 'projects.test',
      names: [
        'keeps projects behind a sign-in',
        'lists only the signed-in user’s projects',
        'searches by name and description',
        'pages through a long list',
        'creates a project owned by the signed-in user',
        'rejects an invalid project',
        'ignores an owner sent with the form',
        'edits a project',
        'deletes a project',
        'answers 404 for a project that does not exist',
        'forbids another user from seeing, changing or deleting a project',
        'shows the project counts on the dashboard',
      ],
    },
    {
      file: 'project-policy.test',
      names: [
        'lets the owner view, update and delete',
        'refuses everyone else',
        'lets any signed-in user create one',
      ],
    },
    {
      file: 'settings/delete-account.test',
      names: ['deletes the account and signs out', 'refuses without the password'],
    },
  ],
};
