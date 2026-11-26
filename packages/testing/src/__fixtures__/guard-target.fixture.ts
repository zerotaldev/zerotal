import { it } from "bun:test";

// Run only by guard.test.ts, as the file a guarded bare run must never reach.
it("target", () => {
  console.log("guard target ran");
});
