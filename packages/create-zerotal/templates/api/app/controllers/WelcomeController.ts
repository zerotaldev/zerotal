import type { HttpContext } from 'zerotal';

export class WelcomeController {
  async index(http: HttpContext): Promise<void> {
    http.json({
      message: 'Welcome to {{name}}!',
      docs:    'https://zerotal.dev/docs',
    });
  }
}
