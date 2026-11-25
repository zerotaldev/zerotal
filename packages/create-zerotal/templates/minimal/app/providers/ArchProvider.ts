// The coding-agent surface. Registered by being in this directory, and console-only:
// it adds `bun zt arch:update`, which refreshes AGENTS.md, .mcp.json and the skills
// after a framework upgrade, and a `doctor` check that says when they have drifted.
// A web process never loads it. Delete this file, `@zerotal/arch` and those files to
// opt out.
export { ArchProvider } from "@zerotal/arch";
