import { Application } from 'zerotal';
import { DatabaseProvider } from 'zerotal/orm';
import { SessionProvider, AuthSessionMiddleware, CookieDriver } from 'zerotal/session';
import { AuthProvider } from 'zerotal/auth';
import { NotificationProvider } from '@zerotal/notifications';
import { QueueProvider } from 'zerotal/queue';
import { createTestApp, type TestApp } from 'zerotal/testing';
import { User } from '../app/models/User.ts';

export const TEST_SESSION_SECRET = 'test-secret';

export function createApp(setup?: () => void): Promise<TestApp> {
  const driver = new CookieDriver(TEST_SESSION_SECRET, 'session');

  return createTestApp(
    () =>
      Application.create({ env: 'test' })
        .register([DatabaseProvider, SessionProvider, AuthProvider, NotificationProvider, QueueProvider])
        .use([
          class extends AuthSessionMiddleware {
            constructor() {
              super(driver, (id) => User.find(id) as Promise<{ id: number } | null>);
            }
          },
        ])
        .useConfig({
          database: { url: ':memory:' },
          session:  { driver: 'cookie', secret: TEST_SESSION_SECRET, cookie: 'session', ttl: 7200 },
          mail:     { driver: 'log', from: { address: 'no-reply@test', name: 'Test' },
                      smtp: { host: 'localhost', port: 1025, secure: false, username: '', password: '' },
                      resend: { apiKey: '' }, log: { channel: 'console' } },
          queue:    { driver: 'sync', connection: ':memory:' },
        }),
    setup,
  );
}
