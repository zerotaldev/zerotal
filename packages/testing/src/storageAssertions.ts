import { Storage } from "@zerotal/core/storage";
import type { StorageDriver } from "@zerotal/core/storage";

function _resolveDriver(diskOrDriver: string | StorageDriver): StorageDriver {
  return typeof diskOrDriver === "string" ? Storage.disk(diskOrDriver) : diskOrDriver;
}

/**
 * Assert that a file exists on the given storage disk or driver.
 *
 * Pass a disk name (string) to use the `Storage` facade (requires StorageProvider
 * to be registered), or pass a `StorageDriver` instance for isolated unit tests.
 *
 * @example
 * // Integration test — disk name:
 * await assertStoredFile('local', 'avatars/42.jpg');
 *
 * // Unit test — driver instance:
 * await assertStoredFile(new LocalDriver('./tmp', '/'), 'report.pdf');
 */
export async function assertStoredFile(
  diskOrDriver: string | StorageDriver,
  path: string,
): Promise<void> {
  const exists = await _resolveDriver(diskOrDriver).exists(path);
  if (!exists) {
    const label = typeof diskOrDriver === "string" ? `disk "${diskOrDriver}"` : "driver";
    throw new Error(
      `assertStoredFile: expected file "${path}" to exist on ${label}, but it was not found.`,
    );
  }
}

/**
 * Assert that a file does NOT exist on the given storage disk or driver.
 *
 * @example
 * await assertMissingFile('local', 'tmp/deleted.txt');
 * await assertMissingFile(driver, 'should-be-gone.txt');
 */
export async function assertMissingFile(
  diskOrDriver: string | StorageDriver,
  path: string,
): Promise<void> {
  const exists = await _resolveDriver(diskOrDriver).exists(path);
  if (exists) {
    const label = typeof diskOrDriver === "string" ? `disk "${diskOrDriver}"` : "driver";
    throw new Error(
      `assertMissingFile: expected file "${path}" NOT to exist on ${label}, but it was found.`,
    );
  }
}
