export { StorageManager } from "./StorageManager.ts";
export { StorageProvider } from "../provider/StorageProvider.ts";
export { Storage } from "./facades/Storage.ts";
export { StorageConfig } from "./config.ts";
export { LocalDriver } from "./drivers/LocalDriver.ts";
export { StorageFilesMiddleware, mountsFrom } from "./StorageFilesMiddleware.ts";
export type { StorageFilesOptions } from "./StorageFilesMiddleware.ts";
export { S3Driver } from "./drivers/S3Driver.ts";
export { FakeDisk } from "./FakeDisk.ts";
export type { FakeStoredFile } from "./FakeDisk.ts";
export type {
  StorageDriver,
  StorageConfigShape,
  DiskConfig,
  LocalDiskConfig,
  S3DiskConfig,
  PutOptions,
  DiskServeConfig,
} from "./types.ts";

// Typed error vocabulary
export * from "./errors.ts";
