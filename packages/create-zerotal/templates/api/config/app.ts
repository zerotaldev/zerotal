import { env } from 'zerotal';

export default {
  name: '{{name}}',
  env:  env('APP_ENV', 'console'),
  key:  env('APP_KEY', ''),
  url:  env('APP_URL', 'http://localhost:3000'),
};
