let _version = "";

/**
 * Set the current asset version. Called by InertiaProvider during onBooting().
 *
 * @param v - The asset version string (from `inertia.version` config).
 * @internal
 */
export function setAssetVersion(v: string): void {
  _version = v;
}

/**
 * Returns the current asset version.
 * Used in every PageObject response so the client can detect
 * asset changes and trigger a full reload (409 Conflict response).
 *
 * @returns The asset version string (empty until set at boot).
 */
export function assetVersion(): string {
  return _version;
}
