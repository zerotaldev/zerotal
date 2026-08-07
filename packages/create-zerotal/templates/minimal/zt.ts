#!/usr/bin/env bun
// zt.ts — Zerotal CLI entry point.
// ─────────────────────────────────────────────────────────────────
// Managed by the framework. All orchestration lives in @zerotal/core's
// startZerotal(); this file just hands it the app's bootstrap module.
//
// Run commands with:  bun zt <command>
//   bun zt serve [--port=3000] [--dev]   Start the HTTP server
//   bun zt worker                        Start the background worker
//   bun zt test                          Run tests with the app booted
//   bun zt list                          Show all available commands
// ─────────────────────────────────────────────────────────────────
import { startZerotal } from "zerotal";

await startZerotal(() => import("./bootstrap/app"));
