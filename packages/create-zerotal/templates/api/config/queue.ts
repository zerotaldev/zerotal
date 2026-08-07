import { env } from 'zerotal';

export default {
  driver:     env('QUEUE_DRIVER', 'sync'),
  connection: env('DATABASE_URL', '{{db_url}}'),
};
