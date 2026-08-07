import { Application } from 'zerotal';
import { DatabaseProvider } from 'zerotal/orm';
import { SessionProvider } from 'zerotal/session';
import { AuthProvider } from 'zerotal/auth';
import { NotificationProvider } from '@zerotal/notifications';
import { QueueProvider } from 'zerotal/queue';
import { LogProvider } from 'zerotal/logger';

export default Application.create({
  providers: [
    DatabaseProvider,
    SessionProvider,
    AuthProvider,
    NotificationProvider,
    QueueProvider,
    LogProvider,
  ],
})
  .routing({ web: `${import.meta.dir}/../routes/index.ts` });
