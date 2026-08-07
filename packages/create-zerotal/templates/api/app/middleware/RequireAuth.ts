import type { HttpContext, Pipe, NextFn } from 'zerotal';

export class RequireAuth implements Pipe<HttpContext> {
  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    if (!http.user) {
      return Response.json({ message: 'Unauthenticated.' }, { status: 401 });
    }
    return next();
  }
}
