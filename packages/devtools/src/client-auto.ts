/**
 * Auto-start entry for the server-injected devtools client. This is bundled for
 * the browser on demand and served at `GET /__zerotal/devtools/client.js`, then
 * injected into dev HTML responses by the core dev injector — so apps get the
 * floating panel with no `DevTools.start()` call in their own bundle.
 */
import { DevTools } from "./client/index.ts";

DevTools.start();
