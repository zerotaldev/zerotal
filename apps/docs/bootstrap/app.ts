import { Application } from "zerotal";
import providers from "./providers.ts";

export default Application.create({ providers })
  .routing({ web: `${import.meta.dir}/../routes/index.ts` })
  .fileBasedRouting({ web: `${import.meta.dir}/../app/routes` })
  // Live Flow showcase — file-based so pages get __sourceFile automatically (the AOT
  // compiler + bind-name injection need it); the prefix keeps the /showcase/flow/** URLs.
  .fileBasedRouting({
    dir: `${import.meta.dir}/../app/showcase`,
    prefix: "/showcase",
  });
