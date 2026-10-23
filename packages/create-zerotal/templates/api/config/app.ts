import { env, requireEnv } from 'zerotal';
import { AppConfig } from 'zerotal/config';

// `AppConfig` is what fills `allowedOrigins` from `url`, and `zt doctor` fails an app
// where that list is empty. A bare object here skipped it, so a brand-new API failed
// its own doctor before a single route was written.
export default AppConfig({
  name: '{{name}}',
  url:  env('APP_URL', 'http://localhost:3000'),
  /**
   * The APP_KEY signs sessions and encrypts values, and should be a random 32 byte
   * string. `.env` already has one for this project; `bun zt key:generate` makes
   * another.
   */
  key: requireEnv('APP_KEY'),

  // Same-origin unless CORS_ORIGIN names somewhere else. `'*'` would let any website
  // read this API's responses out of a visitor's browser.
  cors: {
    origin: env('CORS_ORIGIN', ''),
    credentials: false,
  },

  // HSTS, once you are serving over HTTPS.
  secureHeaders: {
    secure: env('APP_SECURE', false),
  },

  throttle: {
    maxAttempts: 120,
    windowSeconds: 60,
  },
});
