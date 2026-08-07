export { createTestApp, TestApp } from "./TestApp.ts";
export type { TestFileInput, TestFormValue } from "./TestApp.ts";
export { TestResponse } from "./TestResponse.ts";
export type { SessionDecoder, TestResponseContext, InertiaPage } from "./TestResponse.ts";
export { withDatabase } from "./withDatabase.ts";
export { refreshDatabase } from "./refreshDatabase.ts";
export type { RefreshDatabaseOptions } from "./refreshDatabase.ts";
export { migrateDatabase } from "./migrateDatabase.ts";
export type { MigrateDatabaseOptions } from "./migrateDatabase.ts";
export { resetTestState } from "./resetTestState.ts";
export { assertDatabaseHas, assertDatabaseMissing, assertDatabaseCount } from "./assertions.ts";
export { assertStoredFile, assertMissingFile } from "./storageAssertions.ts";
export { Factory, FactoryBatch } from "./factory.ts";
export type { FactoryPayload } from "./factory.ts";
export { fake } from "./fake.ts";
export { fakeFile } from "./fakeFile.ts";
export type { FakeFile } from "./fakeFile.ts";

// Testing fakes. Each one lives with the subsystem it stands in for; the ones
// whose package this already depends on are re-exported here so a test does not
// have to know which package a given fake ships in. The two that would pull a
// new dependency in are reached through their own facades instead:
// `Broadcast.fake()` from @zerotal/broadcasting and `Social.fake()` from
// @zerotal/auth.
export { EventFake } from "@zerotal/core";
export { Http } from "@zerotal/core/http";
export { QueueFake } from "@zerotal/queue";
export { NotificationFake } from "@zerotal/notifications";
export { FakeDisk } from "@zerotal/core/storage";
export type { FakeStoredFile } from "@zerotal/core/storage";
