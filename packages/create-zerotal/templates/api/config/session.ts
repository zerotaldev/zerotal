import { env } from 'zerotal';
import { SessionConfig } from 'zerotal/session';

export default SessionConfig({
  driver:   env('SESSION_DRIVER', 'cookie') as 'cookie' | 'redis',
  cookie:   env('SESSION_NAME',   'session'),
  secret:   env('SESSION_SECRET') ?? env('APP_KEY', ''),
  lifetime: env('SESSION_TTL',    7200),
  secure:   env('APP_ENV') === 'production',
});
