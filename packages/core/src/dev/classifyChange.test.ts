/**
 * What a saved file does under `zt dev`: restart the server, rebuild assets, or nothing.
 */
import { describe, it, expect } from "bun:test";
import { _classifyChange } from "./DevOrchestrator.ts";

describe("_classifyChange()", () => {
  it("restarts the server for backend files", () => {
    for (const path of [
      "app/models/User.ts",
      "routes/web.ts",
      "bootstrap/app.ts",
      "config/app.ts",
      "resources/app.html",
    ]) {
      expect(_classifyChange(path)).toBe("restart");
    }
  });

  it("rebuilds assets for frontend files", () => {
    expect(_classifyChange("resources/js/app.ts")).toBe("rebuild");
    expect(_classifyChange("resources/css/app.css")).toBe("rebuild");
    expect(_classifyChange("resources/pages/Home.tsx")).toBe("rebuild");
  });

  it("restarts for the .env files, which the leading-dot rule used to drop", () => {
    expect(_classifyChange(".env")).toBe("restart");
    expect(_classifyChange(".env.local")).toBe("restart");
    expect(_classifyChange(".env.development")).toBe("restart");
    expect(_classifyChange(".env.example")).toBeNull();
  });

  it("restarts for translations, read at boot", () => {
    expect(_classifyChange("lang/en.json")).toBe("restart");
    expect(_classifyChange("resources/lang/fr/messages.json")).toBe("restart");
  });

  it("ignores hidden files, output directories and the build's own output", () => {
    for (const path of [
      ".git/index",
      ".zerotal/cache.json",
      ".vscode/settings.json",
      "node_modules/zerotal/index.ts",
      "public/build/app.js",
      "types/routes.generated.ts",
      "resources/js/pages.generated.ts",
      "README.md",
    ]) {
      expect(_classifyChange(path)).toBeNull();
    }
  });

  it("normalises Windows separators", () => {
    expect(_classifyChange("app\\models\\User.ts")).toBe("restart");
  });

  it("adds the app's own paths from app.dev.watch", () => {
    const watch = {
      restart: ["content/", "schema.graphql", "data/**/*.json"],
      rebuild: ["resources/svg/"],
    };

    expect(_classifyChange("content/posts/hello.md", watch)).toBe("restart");
    expect(_classifyChange("schema.graphql", watch)).toBe("restart");
    expect(_classifyChange("data/en/terms.json", watch)).toBe("restart");
    expect(_classifyChange("data/en/terms.txt", watch)).toBeNull();
    expect(_classifyChange("resources/svg/logo.svg", watch)).toBe("rebuild");
    // Not a way to watch inside an ignored directory.
    expect(_classifyChange("node_modules/x.json", { restart: ["node_modules/"] })).toBeNull();
  });
});
