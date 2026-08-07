import { env } from 'zerotal';
import { NotificationConfig } from '@zerotal/notifications';

export default NotificationConfig({
  // The mail channel — delivery is via the configured driver (log/smtp/resend).
  mail: {
    driver: env('MAIL_DRIVER', 'log') as 'log' | 'smtp' | 'resend',
    from: {
      address: env('MAIL_FROM_ADDRESS', 'noreply@{{name}}.local'),
      name:    env('MAIL_FROM_NAME',    '{{name}}'),
    },
  },
});
