/**
 * The entry `optionalPeers.test.ts` bundles and runs, standing in for a compiled app.
 *
 * It boots the database provider against an in-memory SQLite database, which is what loads
 * `@zerotal/validator` to wire its `unique()` and `exists()` rules, and prints one JSON line:
 * whether the boot finished (or the error's class and message), and, when the validator is
 * there, whether a `unique()` rule reached the database.
 */
import { SQL } from "bun";
import { DatabaseProvider } from "../provider/DatabaseProvider.ts";

/** The part of `@zerotal/validator` this checks the wiring with. */
interface ValidatorModule {
  RuleBuilder: new () => {
    string(): { unique(table: string, column: string): { _def: unknown } };
  };
  runValidationAsync(
    schema: Record<string, unknown>,
    input: Record<string, unknown>,
  ): Promise<{ success: boolean; errors?: Record<string, string> }>;
}

const db = new SQL(":memory:");
await db`CREATE TABLE users (email TEXT)`;
await db`INSERT INTO users (email) VALUES ('taken@example.com')`;

const config = { get: (_path: string, fallback?: unknown) => fallback };
const app = {
  container: {
    singleton: () => {},
    make: async (key: string) => (key === "config" ? config : db),
    makeSync: () => db,
    tryMake: () => null,
  },
};

let boot: Record<string, unknown>;
try {
  // The provider takes the application; this stub has the parts registering and booting read.
  const provider = new DatabaseProvider(app as never);
  provider.onRegister();
  await provider.onBooting();
  boot = { booted: true };
} catch (error) {
  boot = {
    threw: error instanceof Error ? error.constructor.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  };
}

// Whether `unique()` found the taken address: `null` when the validator cannot be loaded here.
let uniqueRule: Record<string, unknown> | null = null;
const validator: ValidatorModule | null = await import("@zerotal/validator" as string).catch(
  () => null,
);
if (validator && boot["booted"]) {
  const schema = { email: new validator.RuleBuilder().string().unique("users", "email")._def };
  const result = await validator.runValidationAsync(schema, { email: "taken@example.com" });
  uniqueRule = { success: result.success, error: result.errors?.["email"] ?? null };
}

console.log(JSON.stringify({ boot, uniqueRule }));
