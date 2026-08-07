import { Application, basePath } from 'zerotal';
import { LogProvider } from 'zerotal/logger';

const app = Application.create({ providers: [LogProvider] })
  .routing({
    web: basePath("routes/index.ts"),
  });

export default app;